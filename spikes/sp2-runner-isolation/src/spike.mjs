// Full SP-2 measurement. `npm run spike` prints a JSON summary on stdout (progress on stderr).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAttacks, runSqlAttacks } from './harness.mjs';
import { runLatency } from './latency.mjs';
import { watchdogOvershoot, premiseChecks } from './experiments.mjs';
import { RUN_ROOT } from './runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const log = (m) => console.error(m);
const want = (k) => !only || only === k;
const summary = { env: { node: process.version, os: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, platform: process.platform, uid: process.getuid?.() } };

if (want('attacks')) {
  log('== JS/TS escape attempts ==');
  const a = await runAttacks(log);
  const nonAcc = a.rows.filter((r) => !r.accepted);
  summary.attacks = {
    total: a.rows.length, pass: a.rows.filter((r) => r.pass).length, fail: a.rows.filter((r) => !r.pass).map((r) => r.id),
    acceptedRisk: a.rows.filter((r) => r.accepted).map((r) => r.id),
    matrix: {
      controlNone_escaped: nonAcc.filter((r) => r.none?.escaped).length,
      permissionOnly_escaped: nonAcc.filter((r) => r.permission?.escaped).map((r) => r.id),
      full_escaped: nonAcc.filter((r) => r.full?.escaped).map((r) => r.id),
      controlInvalid: nonAcc.filter((r) => r.none && !r.controlValid).map((r) => r.id),
    },
    rows: a.rows,
  };
  log('== SQL attempts ==');
  const s = await runSqlAttacks(log);
  summary.sql = { total: s.rows.length, pass: s.rows.filter((r) => r.pass).length, fail: s.rows.filter((r) => !r.pass).map((r) => r.id), functional: s.functional, rows: s.rows, loadExtensionRaw: { stdout: s.loadExtensionRawStdout, stderr: s.loadExtensionRawStderr } };
}
if (want('experiments')) {
  log('== experiments ==');
  summary.premise = await premiseChecks(log);
  summary.watchdog = await watchdogOvershoot(log);
}
if (want('latency')) {
  log('== latency ==');
  summary.latency = await runLatency(log);
}
summary.tmpRootEntriesAtEnd = fs.existsSync(RUN_ROOT) ? fs.readdirSync(RUN_ROOT).length : 0;
fs.mkdirSync(path.join(HERE, '..', 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, '..', 'results', only ? `result-${only}.json` : 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, attacks: summary.attacks && { ...summary.attacks, rows: undefined }, sql: summary.sql && { ...summary.sql, rows: undefined } }, null, 1));
