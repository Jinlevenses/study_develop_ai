#!/usr/bin/env node
// check:scope (PR-006, UR-06, CR-59, STD-DIR-40·STD-AGT-13, D-STD-18) — 변경 파일이 Task Brief의 allowed_paths 안인지 검사.
// 사용: node tools/gates/check-scope.mjs --task <T-nn-mm> [--base <ref>] [--changed-from <file>] [--brief <path>] [--root <dir>] [--json] [--quiet]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { expandBraces, matchAny } from './lib/glob.mjs';
import { changedFiles } from './lib/git.mjs';

const TASK_RE = /^T-(\d{2})-\d{2}(-r\d+)?$/;

/** 생성물 표(STD §2.7): 판정 함수 + 허용 항목의 리터럴 접두에 있어야 하는 표지. */
const GENERATED = [
  { test: (f) => /\.gen\.ts$/.test(f), marker: '.gen.', label: '*.gen.ts' },
  { test: (f) => f.startsWith('packages/contracts/.snapshots/'), marker: '.snapshots/', label: 'contracts snapshots' },
  { test: (f) => f.startsWith('docs/40-impl/graph/'), marker: 'docs/40-impl/graph/', label: 'graph snapshots' },
  {
    test: (f) => f.startsWith('docs/40-impl/reports/') && !f.startsWith('docs/40-impl/reports/tasks/'),
    marker: 'docs/40-impl/reports/',
    label: 'generated reports',
  },
];

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/** Brief 텍스트에서 `allowed_paths:` 목록을 줄 단위로 읽는다. 없음·0개 → []. */
export function parseAllowedPaths(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('allowed_paths:'));
  if (start < 0) {
    return [];
  }
  const inline = lines[start].slice('allowed_paths:'.length).trim();
  if (inline.startsWith('[')) {
    try {
      const arr = JSON.parse(inline);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) {
      continue;
    }
    const m = /^\s*-\s+(.+)$/.exec(l);
    if (!m) {
      break;
    }
    const item = unquote(m[1].replace(/\s+#\s.*$/, '').trim());
    if (item !== '') {
      out.push(item);
    }
  }
  return out;
}

/** 첫 와일드카드(`*`·`?`) 앞 리터럴 부분. */
function literalPrefix(pattern) {
  const i = pattern.search(/[*?]/);
  return i < 0 ? pattern : pattern.slice(0, i);
}

export function evaluateScope(changed, allowed, task) {
  const expanded = allowed.flatMap((p) => expandBraces(p));
  const auto = `docs/40-impl/reports/tasks/${task}.json`;
  const out = [];
  const add = (file, rule, message) => out.push({ file, line: 0, rule, message, severity: 'error' });
  for (const f of changed) {
    if (f.startsWith('graphify-out/')) {
      add(f, 'scope/graphify-out', 'graphify-out/** is updated by T0 only (STD §18.5, D-STD-18)');
      continue;
    }
    if (f.startsWith('spikes/')) {
      add(f, 'scope/spikes', 'spikes/** is frozen read-only (STD-DIR-07)');
      continue;
    }
    const autoAllowed = f === auto;
    const matching = expanded.filter((p) => matchAny(f, [p]));
    if (!autoAllowed && matching.length === 0) {
      add(f, 'scope/outside-allowed', `${f} is outside the allowed_paths of ${task} (STD-AGT-13)`);
    }
    const gen = GENERATED.find((g) => g.test(f));
    if (gen && !autoAllowed && !matching.some((p) => literalPrefix(p).includes(gen.marker))) {
      add(
        f,
        'scope/generated',
        `${f} is a generated file (${gen.label}); allowed_paths must name it explicitly, not via a broad glob (STD §2.7)`,
      );
    }
  }
  return out;
}

export async function analyze(root, opts) {
  const task = opts.task;
  if (task === undefined) {
    throw new GateEngineError('engine/usage', '--task <T-nn-mm> is required');
  }
  const m = TASK_RE.exec(task);
  if (!m) {
    throw new GateEngineError('engine/usage', `--task must match ^T-\\d{2}-\\d{2}(-r\\d+)?$ (got ${task})`);
  }
  const briefRel = opts.brief ?? `docs/40-impl/briefs/IT-${m[1]}/${task}.md`;
  const briefAbs = path.resolve(root, briefRel);
  if (!existsSync(briefAbs)) {
    throw new GateEngineError('engine/input-missing', `Task Brief not found: ${briefRel}`);
  }
  const allowed = parseAllowedPaths(readFileSync(briefAbs, 'utf8'));
  if (allowed.length === 0) {
    throw new GateEngineError('engine/input-missing', `no allowed_paths list found in ${briefRel}`);
  }
  const changed = changedFiles(root, { base: opts.base ?? 'HEAD', changedFrom: opts.changedFrom });
  if (changed.length === 0) {
    throw new GateEngineError('engine/input-missing', 'no changed files (check --base)');
  }
  return { files: changed.length, violations: evaluateScope(changed, allowed, task), extra: { task } };
}

if (isMain(import.meta.url)) {
  await runGate(
    { id: 'check:scope', requireUnits: false, spec: { options: ['task', 'base', 'changed-from', 'brief'] } },
    (o) =>
      analyze(o.root, {
        task: o.get('task'),
        base: o.get('base'),
        changedFrom: o.get('changed-from') ? path.resolve(o.get('changed-from')) : undefined,
        brief: o.get('brief'),
      }),
  );
}
