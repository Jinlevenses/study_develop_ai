#!/usr/bin/env node
// check:consumers (NFR-MAINT-003, IF-01 §9.5) — 소비자 매니페스트(`__consumers__/<consumer>.json`)를 이벤트 payload 스냅샷과 대조한다.
//   consumers/schema · file-name · drop-not-notify · no-producer-schema · reads-missing · routing-stale
//   스냅샷 이름 규약(Brief 결정): <snapshots>/<event.type>.v<schema_version>.json (z.toJSONSchema 결과)
// 사용: node tools/gates/check-consumers.mjs [--root <dir>] [--manifests <dir>] [--snapshots <dir>] [--routing <file>] [--json] [--quiet]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';

const CONSUMERS = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const MODES = ['durable', 'notify'];
const POISON = ['halt', 'dead_letter', 'drop'];
const TYPE_RE = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;
const READS_RE = /^(\*|[a-z_]+(\.[a-z_]+)*)$/;
const SUB_KEYS = ['type', 'schema_versions', 'mode', 'on_poison', 'reads'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 손으로 구현한 ConsumerManifest 검사(zod import 금지). 반환 problems: [{message, needle?}]. */
export function validateManifest(json) {
  const problems = [];
  const p = (message, needle) => problems.push({ message, needle });
  if (!isObject(json)) {
    p('manifest must be a JSON object');
    return problems;
  }
  for (const k of Object.keys(json)) {
    if (k !== 'consumer' && k !== 'subscriptions') {
      p(`unknown key "${k}"`, `"${k}"`);
    }
  }
  if (!CONSUMERS.includes(json.consumer)) {
    p(`consumer must be one of ${CONSUMERS.join(', ')}`, '"consumer"');
  }
  if (!Array.isArray(json.subscriptions)) {
    p('subscriptions must be an array', '"subscriptions"');
    return problems;
  }
  if (json.subscriptions.length > 40) {
    p(`subscriptions has ${json.subscriptions.length} entries (max 40)`, '"subscriptions"');
  }
  json.subscriptions.forEach((s, i) => {
    const at = `subscriptions[${i}]`;
    if (!isObject(s)) {
      p(`${at} must be an object`);
      return;
    }
    const needle = typeof s.type === 'string' ? `"${s.type}"` : undefined;
    for (const k of Object.keys(s)) {
      if (!SUB_KEYS.includes(k)) {
        p(`${at}: unknown key "${k}"`, `"${k}"`);
      }
    }
    for (const k of SUB_KEYS) {
      if (!(k in s)) {
        p(`${at}: missing key "${k}"`, needle);
      }
    }
    if ('type' in s && !(typeof s.type === 'string' && TYPE_RE.test(s.type))) {
      p(`${at}.type must match ${TYPE_RE.source}`, '"type"');
    }
    if (
      'schema_versions' in s &&
      !(
        Array.isArray(s.schema_versions) &&
        s.schema_versions.length >= 1 &&
        s.schema_versions.every((n) => Number.isInteger(n) && n >= 1)
      )
    ) {
      p(`${at}.schema_versions must be a non-empty array of integers >= 1`, needle);
    }
    if ('mode' in s && !MODES.includes(s.mode)) {
      p(`${at}.mode must be one of ${MODES.join(', ')}`, needle);
    }
    if ('on_poison' in s && !POISON.includes(s.on_poison)) {
      p(`${at}.on_poison must be one of ${POISON.join(', ')}`, needle);
    }
    if (
      'reads' in s &&
      !(
        Array.isArray(s.reads) &&
        s.reads.length >= 1 &&
        s.reads.every((r) => typeof r === 'string' && READS_RE.test(r))
      )
    ) {
      const bad = Array.isArray(s.reads)
        ? s.reads.find((r) => !(typeof r === 'string' && READS_RE.test(r)))
        : undefined;
      p(`${at}.reads must be a non-empty array of ${READS_RE.source}`, typeof bad === 'string' ? `"${bad}"` : needle);
    }
  });
  return problems;
}

/** `$ref`(`#/$defs/X`·`#/definitions/X`) 해석. */
function deref(node, rootSchema) {
  let cur = node;
  for (let n = 0; n < 16 && isObject(cur) && typeof cur.$ref === 'string'; n++) {
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(cur.$ref);
    if (!m) {
      return undefined;
    }
    cur = rootSchema?.[m[1]]?.[m[2]];
  }
  return cur;
}

/** 점 경로가 스키마에 있는가: properties → $ref → anyOf/oneOf/allOf(하나라도) → array면 items. */
export function pathExists(schema, segs, rootSchema = schema, depth = 0) {
  if (segs.length === 0) {
    return true;
  }
  if (depth > 24) {
    return false;
  }
  const node = deref(schema, rootSchema);
  if (!isObject(node)) {
    return false;
  }
  const [seg, ...rest] = segs;
  if (
    isObject(node.properties) &&
    seg in node.properties &&
    pathExists(node.properties[seg], rest, rootSchema, depth + 1)
  ) {
    return true;
  }
  for (const k of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(node[k]) && node[k].some((b) => pathExists(b, segs, rootSchema, depth + 1))) {
      return true;
    }
  }
  if ((node.type === 'array' || node.items !== undefined) && isObject(node.items)) {
    return pathExists(node.items, segs, rootSchema, depth + 1);
  }
  return false;
}

const lineOfNeedle = (lines, needle) => {
  if (!needle) {
    return 1;
  }
  const i = lines.findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : 1;
};

export function analyze(root, opts = {}) {
  const manifestsDir = path.resolve(root, opts.manifests ?? 'packages/contracts/src/events/__consumers__');
  const snapDir = path.resolve(root, opts.snapshots ?? 'packages/contracts/.snapshots/events');
  const routingAbs = path.resolve(root, opts.routing ?? 'packages/contracts/src/events/routing.gen.ts');
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  let names = [];
  try {
    names = readdirSync(manifestsDir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    names = [];
  }
  if (names.length === 0) {
    throw new GateEngineError('engine/input-missing', `no consumer manifests (*.json) in ${rel(manifestsDir)}`);
  }
  const routingText = existsSync(routingAbs) ? readFileSync(routingAbs, 'utf8') : null;
  const snapCache = new Map();
  const snapshot = (type, ver) => {
    const f = path.join(snapDir, `${type}.v${ver}.json`);
    if (!snapCache.has(f)) {
      let v = null;
      if (existsSync(f)) {
        try {
          v = JSON.parse(readFileSync(f, 'utf8'));
        } catch (e) {
          throw new GateEngineError('engine/input-missing', `${rel(f)}: invalid JSON (${e.message})`);
        }
      }
      snapCache.set(f, v);
    }
    return snapCache.get(f);
  };
  const violations = [];
  for (const name of names) {
    const file = rel(path.join(manifestsDir, name));
    const text = readFileSync(path.join(manifestsDir, name), 'utf8');
    const lines = text.split('\n');
    const add = (line, rule, message) => violations.push({ file, line, rule, message, severity: 'error' });
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      add(1, 'consumers/schema', `invalid JSON: ${e.message}`);
      continue;
    }
    for (const pr of validateManifest(json)) {
      add(lineOfNeedle(lines, pr.needle), 'consumers/schema', pr.message);
    }
    if (isObject(json) && typeof json.consumer === 'string' && name !== `${json.consumer}.json`) {
      add(
        lineOfNeedle(lines, '"consumer"'),
        'consumers/file-name',
        `file name must be ${json.consumer}.json (found ${name})`,
      );
    }
    if (!isObject(json) || !Array.isArray(json.subscriptions)) {
      continue;
    }
    for (const s of json.subscriptions) {
      if (!isObject(s) || typeof s.type !== 'string') {
        continue;
      }
      const line = lineOfNeedle(lines, `"${s.type}"`);
      if (s.on_poison === 'drop' && s.mode === 'durable') {
        add(line, 'consumers/drop-not-notify', `${s.type}: on_poison "drop" is for mode "notify" only`);
      }
      if (routingText !== null && !routingText.includes(s.type)) {
        add(
          line,
          'consumers/routing-stale',
          `${s.type} is not in the generated routing table (run pnpm contracts:gen)`,
        );
      }
      const versions = Array.isArray(s.schema_versions)
        ? s.schema_versions.filter((n) => Number.isInteger(n) && n >= 1)
        : [];
      for (const v of versions) {
        const schema = snapshot(s.type, v);
        if (schema === null) {
          add(
            line,
            'consumers/no-producer-schema',
            `${s.type} v${v}: no producer snapshot ${rel(path.join(snapDir, `${s.type}.v${v}.json`))}`,
          );
          continue;
        }
        const missing = (Array.isArray(s.reads) ? s.reads : []).filter(
          (r) => typeof r === 'string' && r !== '*' && READS_RE.test(r) && !pathExists(schema, r.split('.')),
        );
        if (missing.length > 0) {
          add(
            line,
            'consumers/reads-missing',
            `${s.type} v${v}: reads ${missing.map((r) => `"${r}"`).join(', ')} not in the payload schema`,
          );
        }
      }
    }
  }
  return { files: names.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate(
    { id: 'check:consumers', requireUnits: true, spec: { options: ['manifests', 'snapshots', 'routing'] } },
    (o) => analyze(o.root, { manifests: o.get('manifests'), snapshots: o.get('snapshots'), routing: o.get('routing') }),
  );
}
