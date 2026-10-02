#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: 테스트 러너 env(FATHOM_INT·FATHOM_ISOLATION) — turbo 캐시 대상 아님
// 결정성 러너 (TST-01 §3.5·§7.3, NFR-MAINT-009): 단위 vitest 16개를 seed 1·2로 섞어 돌려 (테스트 이름 → 상태) 맵을 비교한다.
// 사용: node tests/support/determinism.mjs [--units=apps/web,packages/contracts]
// 종료 코드: 0 = 같음 · 1 = 다름 · 2 = 엔진 고장(JSON 없음·파싱 실패).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const ALL_UNITS = [
  'apps/web',
  'apps/cli',
  'services/gateway',
  'services/content',
  'services/learning',
  'services/ai-gateway',
  'services/ops',
  'packages/contracts',
  'packages/shared-kernel',
  'packages/design-tokens',
  'packages/ui',
  'packages/testkit',
  'tools/packc',
  'tools/graph',
  'tools/fake-cli',
  'tools/si-docs',
];
const SEEDS = [1, 2];
const MAX_DIFF = 200;

function engineFailure(message) {
  process.stderr.write(`determinism: ${message}\n`);
  process.exit(2);
}

function selectUnits(argv) {
  let units = ALL_UNITS;
  for (const arg of argv) {
    const m = /^--units=(.+)$/.exec(arg);
    if (m === null) {
      engineFailure(`unknown argument ${arg}`);
    }
    units = m[1].split(',').filter((u) => u !== '');
    for (const unit of units) {
      if (!ALL_UNITS.includes(unit)) {
        engineFailure(`unknown unit ${unit}`);
      }
    }
  }
  return units;
}

function runUnit(unit, seed, tmp) {
  const slug = unit.replaceAll('/', '-');
  const outputFile = path.join(tmp, `${slug}-${seed}.json`);
  const run = spawnSync(
    process.execPath,
    [
      '--conditions=source',
      VITEST,
      'run',
      '--project',
      'unit',
      '--configLoader',
      'native',
      '--sequence.shuffle',
      `--sequence.seed=${seed}`,
      '--reporter=json',
      `--outputFile=${outputFile}`,
    ],
    { cwd: path.join(REPO_ROOT, unit), stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
  );
  let json;
  try {
    json = JSON.parse(readFileSync(outputFile, 'utf8'));
  } catch (cause) {
    engineFailure(
      `${unit} seed ${seed}: no parsable JSON report (exit ${run.status}) ${String(cause)}\n${run.stderr.slice(-800)}`,
    );
  }
  const map = new Map();
  for (const file of json.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      map.set(test.fullName, test.status);
    }
  }
  return map;
}

function compare(unit, a, b, diff) {
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(name) !== b.get(name) && diff.length < MAX_DIFF) {
      diff.push({ unit, test: name, seed1: a.get(name) ?? 'missing', seed2: b.get(name) ?? 'missing' });
    }
  }
}

function main() {
  const units = selectUnits(process.argv.slice(2));
  const intEnv = process.env.FATHOM_INT ?? '';
  const int = /^(INT-[0-9a-z]+|PG-3|local)$/.test(intEnv) ? intEnv : 'local';
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fathom-determinism-'));
  const summary = [];
  const diff = [];
  try {
    for (const unit of units) {
      const [first, second] = SEEDS.map((seed) => runUnit(unit, seed, tmp));
      summary.push({ unit, tests: first.size });
      compare(unit, first, second, diff);
      process.stdout.write(`determinism: ${unit} ${first.size} tests${diff.length > 0 ? ' (DIFF)' : ''}\n`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const equal = diff.length === 0;
  const reportDir = path.join(REPO_ROOT, '.reports', int);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    path.join(reportDir, 'determinism.json'),
    `${JSON.stringify({ equal, seeds: SEEDS, units: summary, diff }, null, 2)}\n`,
  );
  process.stdout.write(`determinism: equal=${equal}\n`);
  process.exit(equal ? 0 : 1);
}

main();
