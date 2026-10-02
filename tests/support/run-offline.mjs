#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: 테스트 러너 env(FATHOM_INT·FATHOM_ISOLATION) — turbo 캐시 대상 아님
// offline 단계 진입 탐침 + 명령 실행 (TST-01 §4.3 "offline 단계 진입 조건"·§8.3 L0, D-TST-07).
// 사용: node tests/support/run-offline.mjs [--isolation=L-js|L-hard] -- <cmd> [args…]
// 종료 코드: 0 = 명령 성공 · 2 = 인자 오류·격리 실패(엔진 고장) · 그 밖 = 명령의 종료 코드(신호 사망 = 1).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECORDER_URL = new URL('../../packages/testkit/src/preload/egress-recorder.mjs', import.meta.url).href;
const ISOLATIONS = new Set(['L-js', 'L-hard']);
const PROBE = `
import dns from 'node:dns';
import net from 'node:net';
const out = { connect: 'none', dns: 'none' };
let pending = 2;
const fin = () => {
  pending -= 1;
  if (pending === 0) {
    process.stdout.write(JSON.stringify({ connect: out.connect, dns: out.dns }));
  }
};
net.connect({ host: '203.0.113.1', port: 9 }).on('error', (e) => { out.connect = e.code ?? 'ERR'; fin(); });
dns.lookup('registry.npmjs.org', (e) => { out.dns = e ? (e.code ?? 'ERR') : 'OK'; fin(); });
`;

function usage(message) {
  process.stderr.write(`run-offline: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) {
    usage('usage: run-offline.mjs [--isolation=L-js|L-hard] -- <cmd> [args…]');
  }
  let isolation = process.env.FATHOM_ISOLATION ?? 'L-js';
  for (const arg of argv.slice(0, sep)) {
    const m = /^--isolation=(.+)$/.exec(arg);
    if (m === null) {
      usage(`unknown argument ${arg}`);
    }
    isolation = m[1];
  }
  if (!ISOLATIONS.has(isolation)) {
    usage(`unknown isolation ${isolation}`);
  }
  return { isolation, command: argv[sep + 1], args: argv.slice(sep + 2) };
}

/** L-hard: 호스트에서 실제 외부 연결이 되면 격리 실패. 3초 안에 connect면 도달 가능. */
function probeHard() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: 'registry.npmjs.org', port: 443 });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(3000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** L-js: 기록기 block 모드가 실제로 연결·DNS를 막고 기록하는지 양성 탐침. */
function probeJs() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fathom-offline-'));
  try {
    const run = spawnSync(process.execPath, ['--import', RECORDER_URL, '--input-type=module', '-e', PROBE], {
      env: { PATH: process.env.PATH ?? '', FATHOM_HOME: tmp, FATHOM_EGRESS_MODE: 'block' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    let blockedRows = 0;
    const dir = path.join(tmp, 'tmp', 'egress');
    try {
      for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
        for (const line of readFileSync(path.join(dir, name), 'utf8').split('\n')) {
          if (line.trim() !== '' && JSON.parse(line).blocked === true) {
            blockedRows += 1;
          }
        }
      }
    } catch {
      blockedRows = 0;
    }
    let parsed = { connect: 'none', dns: 'none' };
    try {
      parsed = JSON.parse(run.stdout);
    } catch {
      // 탐침 실패 — 아래 판정에서 걸린다.
    }
    const passed = run.stdout === '{"connect":"ECONNREFUSED","dns":"ENOTFOUND"}' && blockedRows >= 2;
    return { passed, probe: { connect: parsed.connect, dns: parsed.dns, blocked_rows: blockedRows } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sumTotals(specs) {
  const totals = { l1: 0, l2_remotes: 0, l3: 0, l4: 0 };
  for (const spec of Object.values(specs)) {
    for (const key of Object.keys(totals)) {
      if (spec !== null && typeof spec === 'object' && typeof spec[key] === 'number') {
        totals[key] += spec[key];
      }
    }
  }
  return totals;
}

function writeReport(int, isolation, hostReachable, probe) {
  const reportDir = path.join(REPO_ROOT, '.reports', int);
  const specDir = path.join(reportDir, 'egress');
  const specs = {};
  try {
    for (const name of readdirSync(specDir).filter((n) => n.endsWith('.json'))) {
      specs[name.slice(0, -'.json'.length)] = readJson(path.join(specDir, name));
    }
  } catch {
    // spec 파일 없음 — specs: {}
  }
  const report = {
    isolation,
    host_reachable: hostReachable,
    ...(isolation === 'L-js' ? { host_reachable_note: 'L-js: 맨 탐침 생략(STD-TST-04)' } : {}),
    probe,
    specs,
    totals: sumTotals(specs),
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(path.join(reportDir, 'egress.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function runCommand(command, args, isolation) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, FATHOM_ISOLATION: isolation },
    });
    child.once('error', (e) => {
      process.stderr.write(`run-offline: spawn failed: ${e.message}\n`);
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const { isolation, command, args } = parseArgs(process.argv.slice(2));
  const int = /^(INT-[0-9a-z]+|PG-3|local)$/.test(process.env.FATHOM_INT ?? '') ? process.env.FATHOM_INT : 'local';
  let probe = { connect: 'n/a', dns: 'n/a', blocked_rows: 0 };
  let hostReachable = null;
  if (isolation === 'L-hard') {
    hostReachable = await probeHard();
    if (hostReachable) {
      process.stderr.write('run-offline: L-hard isolation failed — registry.npmjs.org is reachable\n');
      process.exit(2);
    }
  } else {
    const result = probeJs();
    probe = result.probe;
    if (!result.passed) {
      process.stderr.write(`run-offline: L-js probe failed (${JSON.stringify(result.probe)})\n`);
      process.exit(2);
    }
  }
  rmSync(path.join(REPO_ROOT, '.reports', int, 'egress'), { recursive: true, force: true });
  const code = await runCommand(command, args, isolation);
  writeReport(int, isolation, hostReachable, probe);
  process.exit(code);
}

await main();
