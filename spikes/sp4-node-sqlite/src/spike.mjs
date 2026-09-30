// SP-4 driver.
//   node --disable-warning=ExperimentalWarning src/spike.mjs [--seconds=20]        run everything (each stage in its own process)
//   node --disable-warning=ExperimentalWarning src/spike.mjs --only=features|warnings|concurrency|search   run one stage in-process
// Each stage of a full run is isolated in a child process so a native crash (SIGSEGV was seen twice during development,
// cause unattributed) is recorded per stage instead of losing the whole run; crashed stages are retried once.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const work = join(root, '.work');
const resDir = join(root, 'results');
mkdirSync(work, { recursive: true }); mkdirSync(resDir, { recursive: true });
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? d;
const only = arg('only', 'all'), seconds = Number(arg('seconds', 20));
const save = (name, obj) => writeFileSync(join(resDir, `${name}.json`), JSON.stringify(obj, null, 2));
const log = (m) => process.stderr.write(`[spike] ${m}\n`);

if (only !== 'all') {
  // ---- single stage, in-process ----
  let res;
  if (only === 'features') res = await (await import('./features.mjs')).runFeatures(work);
  else if (only === 'warnings') res = (await import('./warnings.mjs')).runWarnings(work);
  else if (only === 'search') res = await (await import('./search-eval.mjs')).runSearch(work);
  else if (only === 'concurrency') res = await (await import('./concurrency.mjs')).runConcurrency(work, { seconds });
  else throw new Error('unknown stage ' + only);
  save(only, res);
  process.exit(0);
}

// ---- full run ----
const summary = { env: { node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length, mem_gb: Math.round(os.totalmem() / 2 ** 30), work_dir: work }, started: new Date().toISOString(), stage_runs: {} };
for (const stage of ['features', 'warnings', 'search', 'concurrency']) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`${stage} (attempt ${attempt})`);
    const p = join(resDir, `${stage}.json`); rmSync(p, { force: true });
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), `--only=${stage}`, `--seconds=${seconds}`], { stdio: ['ignore', 'inherit', 'inherit'] });
    (summary.stage_runs[stage] ??= []).push({ attempt, exit: r.status, signal: r.signal });
    if (r.status === 0 && existsSync(p)) { summary[stage] = JSON.parse(readFileSync(p, 'utf8')); break; }
    log(`${stage} crashed/failed: exit=${r.status} signal=${r.signal}`);
  }
}

const c = summary.concurrency, s = summary.search;
const compact = { env: summary.env, stage_runs: summary.stage_runs };
if (c) compact.concurrency = {
  three_files_busy5000: { busy_locked_errors: c.B1_three_files_busy5000.writer_busy_or_locked_errors, other_errors: c.B1_three_files_busy5000.writer_other_errors, total_txn_per_s: c.B1_three_files_busy5000.total_txn_per_s, reader_errors: c.B1_three_files_busy5000.reader.error_count, torn: c.B1_three_files_busy5000.reader.tornBatches },
  three_files_busy0: { busy_locked_errors: c.B2_three_files_busy0.writer_busy_or_locked_errors },
  same_file: Object.fromEntries(['C1_same_file_immediate_busy5000', 'C2_same_file_deferred_upgrade_busy5000', 'C3_same_file_immediate_busy0'].map((k) => [k, c[k].busy_or_locked_errors])),
  sigkill_integrity: c.D_sigkill_recovery.verify_after_resume.integrity,
};
if (s) compact.search = { recall_at_10_headline40: Object.fromEntries(Object.entries(s.headline40).map(([k, v]) => [k, v.recall_at_10])), recall_heldout20: Object.fromEntries(Object.entries(s.heldout20).map(([k, v]) => [k, v.recall_at_10])), p95_ms_by_scale: Object.fromEntries(Object.entries(s.scale).map(([k, v]) => [k, v.latency_ms.V2_hybrid_full_like.ALL.p95])) };
if (summary.warnings) compact.warnings = summary.warnings.cases.map((x) => `${x.warning_printed ? 'WARNS ' : 'quiet '} ${x.label}`);
summary.finished = new Date().toISOString();
save('summary', summary);
console.log(JSON.stringify(compact, null, 2));
