import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];

const SCHEMA = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY, writer INTEGER NOT NULL, batch_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    ts INTEGER NOT NULL, payload TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_writer_batch ON events(writer, batch_id);
`;

export function freshDb(path) {
  for (const s of ['', '-wal', '-shm', '-journal']) rmSync(path + s, { force: true });
  const db = new DatabaseSync(path);
  const mode = db.exec(SCHEMA) ?? null;
  db.close();
}
const sz = (p) => (existsSync(p) ? statSync(p).size : 0);
// sample -wal file sizes while a scenario runs (WAL growth is what long-lived readers / heavy writers cause)
function sampleWal(paths, everyMs = 200) {
  const max = paths.map(() => 0);
  const t = setInterval(() => paths.forEach((p, i) => { max[i] = Math.max(max[i], sz(p + '-wal')); }), everyMs);
  return () => { clearInterval(t); return max; };
}

function child(script, cfg) {
  return new Promise((resolve) => {
    const p = spawn(NODE[0], [NODE[1], join(here, script), JSON.stringify(cfg)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code, sig) => {
      try { resolve({ ...JSON.parse(out), exit: code }); }
      catch { resolve({ crashed: true, exit: code, signal: sig, stderr: err.slice(0, 500) }); }
    });
    child.last = p;
  });
}
function childKillable(script, cfg) {
  const p = spawn(NODE[0], [NODE[1], join(here, script), JSON.stringify(cfg)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((res) => p.on('close', (code, sig) => res({ exit: code, signal: sig })));
  return { p, done };
}

const startIn = (ms) => Date.now() + ms;
const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
const busyCount = (r) => Object.entries(r.errors ?? {}).filter(([k]) => /SQLITE_(BUSY|LOCKED)/.test(k)).reduce((a, [, v]) => a + v, 0);

function verifyDb(path, batch = 5) {
  const db = new DatabaseSync(path, { readOnly: false });
  const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join(',');
  const rows = db.prepare('SELECT count(*) c FROM events').get().c;
  const torn = db.prepare('SELECT count(*) c FROM (SELECT 1 FROM events GROUP BY writer,batch_id HAVING count(*)<>?)').get(batch).c;
  db.close();
  return { integrity, rows, torn_batches: torn };
}

export async function runConcurrency(workDir, { seconds = 20 } = {}) {
  mkdirSync(workDir, { recursive: true });
  const out = {};
  const T = (label) => process.stderr.write(`[concurrency] ${label}\n`);

  // ---- A. single-writer baseline (so contention numbers have a reference) ----
  T('A baseline 1 writer x 5s');
  {
    const p = join(workDir, 'base.db'); freshDb(p);
    const s = startIn(600);
    const r = await child('writer.mjs', { db: p, id: 1, startAt: s, endAt: s + 5000, busyTimeout: 5000 });
    out.A_baseline_single_writer = { ...r, verify: verifyDb(p) };
  }
  // ---- A2. synchronous FULL vs NORMAL (WAL) ----
  T('A2 synchronous FULL vs NORMAL x 4s each');
  out.A2_sync_mode = {};
  for (const sync of ['NORMAL', 'FULL']) {
    const p = join(workDir, `sync-${sync}.db`); freshDb(p);
    const s = startIn(500);
    const r = await child('writer.mjs', { db: p, id: 1, startAt: s, endAt: s + 4000, busyTimeout: 5000, sync });
    out.A2_sync_mode[sync] = { txn_per_s: r.txn_per_s, commit_ms: r.commit_ms };
  }

  // ---- B. 3 processes, 3 separate files (WAL) + 1 reader process reading all 3 read-only ----
  for (const [label, busyTimeout, secs] of [['B1_three_files_busy5000', 5000, seconds], ['B2_three_files_busy0', 0, 10]]) {
    T(`${label}: 3 writers (own file) + 1 reader, ${secs}s`);
    const paths = [1, 2, 3].map((i) => join(workDir, `svc${i}.db`));
    paths.forEach(freshDb);
    const s = startIn(1500), e = s + secs * 1000;
    const stopWal = sampleWal(paths);
    const [w1, w2, w3, rd] = await Promise.all([
      ...paths.map((p, i) => child('writer.mjs', { db: p, id: i + 1, startAt: s, endAt: e, busyTimeout })),
      child('reader.mjs', { dbs: paths, startAt: s, endAt: e, batch: 5, timeout: 5000 }),
    ]);
    const ws = [w1, w2, w3];
    const walBytes = stopWal();
    const dbBytes = paths.map((p) => sz(p));
    const ck = paths.map((p) => { const d = new DatabaseSync(p); const r = d.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get(); d.close(); return r; });
    out[label] = {
      busy_timeout_ms: busyTimeout, seconds: secs,
      writers: ws.map((w) => ({ crashed: w.crashed, stderr: w.stderr, id: w.id, committed_txns: w.committed_txns, txn_per_s: w.txn_per_s, error_count: w.error_count, errors: w.errors, commit_ms: w.commit_ms })),
      total_txn_per_s: +sum(ws, (w) => w.txn_per_s).toFixed(1),
      total_rows: sum(ws, (w) => w.rows),
      writer_busy_or_locked_errors: sum(ws, busyCount),
      writer_other_errors: sum(ws, (w) => w.error_count) - sum(ws, busyCount),
      reader: rd,
      wal_bytes_max_sampled_200ms: walBytes, db_bytes_at_end: dbBytes,
      wal_checkpoint_truncate_result: ck,
      verify: paths.map((p) => verifyDb(p)),
    };
  }

  // ---- C. two processes writing the SAME file ----
  const same = async (label, secs, cfgA, cfgB, extra = {}) => {
    T(`${label}: 2 writers, SAME file, ${secs}s`);
    const p = join(workDir, `same-${label}.db`); freshDb(p);
    const s = startIn(800), e = s + secs * 1000;
    const [a, b] = await Promise.all([
      child('writer.mjs', { db: p, id: 1, startAt: s, endAt: e, ...cfgA }),
      child('writer.mjs', { db: p, id: 2, startAt: s, endAt: e, ...cfgB }),
    ]);
    out[label] = {
      seconds: secs, ...extra,
      writers: [a, b].map((w) => ({ crashed: w.crashed, stderr: w.stderr, id: w.id, committed_txns: w.committed_txns, txn_per_s: w.txn_per_s, error_count: w.error_count, errors: w.errors, err_wait_ms: w.err_wait_ms, commit_ms: w.commit_ms })),
      total_txn_per_s: +sum([a, b], (w) => w.txn_per_s || 0).toFixed(1),
      busy_or_locked_errors: sum([a, b], busyCount),
      verify: verifyDb(p),
    };
  };
  const std = { busyTimeout: 5000, begin: 'IMMEDIATE' };
  await same('C1_same_file_immediate_busy5000', seconds, std, std, { note: 'BEGIN IMMEDIATE + busy_timeout=5000 (recommended)' });
  await same('C2_same_file_deferred_upgrade_busy5000', 10, { busyTimeout: 5000, begin: 'DEFERRED_UPGRADE' }, { busyTimeout: 5000, begin: 'DEFERRED_UPGRADE' }, { note: 'BEGIN (deferred) + read, then write; busy_timeout=5000 does NOT help on snapshot upgrade' });
  await same('C3_same_file_immediate_busy0', 10, { busyTimeout: 0, begin: 'IMMEDIATE' }, { busyTimeout: 0, begin: 'IMMEDIATE' }, { note: 'busy_timeout=0' });
  // C4: one writer holds a write txn for 7s; the other has busy_timeout 3000 -> must fail after ~3s, not hang
  {
    T('C4 long write txn (7s hold) vs waiter with busy_timeout=3000');
    const p = join(workDir, 'same-C4.db'); freshDb(p);
    const s = startIn(800), e = s + 12000;
    const [a, b] = await Promise.all([
      child('writer.mjs', { db: p, id: 1, startAt: s, endAt: s + 2000, busyTimeout: 5000, begin: 'IMMEDIATE', holdMs: 7000, holdAtMs: 0 }),
      child('writer.mjs', { db: p, id: 2, startAt: s + 300, endAt: s + 9000, busyTimeout: 3000, begin: 'IMMEDIATE' }),
    ]);
    out.C4_long_write_txn_vs_busy_timeout = { holder: { committed_txns: a.committed_txns, commit_ms: a.commit_ms }, waiter: { committed_txns: b.committed_txns, error_count: b.error_count, errors: b.errors, err_wait_ms: b.err_wait_ms }, verify: verifyDb(p) };
  }

  // ---- D. crash (SIGKILL) recovery ----
  T('D kill -9 during writes, then reopen');
  {
    const p = join(workDir, 'crash.db'); freshDb(p);
    const s = startIn(500);
    const w = childKillable('writer.mjs', { db: p, id: 1, startAt: s, endAt: s + 30000, busyTimeout: 5000, sync: 'NORMAL' });
    await new Promise((r) => setTimeout(r, 2500));
    w.p.kill('SIGKILL');
    const killed = await w.done;
    const walBefore = sz(p + '-wal');
    const v = verifyDb(p);
    // and a new writer can carry on afterwards
    const s2 = startIn(300);
    const r2 = await child('writer.mjs', { db: p, id: 2, startAt: s2, endAt: s2 + 1500, busyTimeout: 5000 });
    out.D_sigkill_recovery = { killed, wal_bytes_after_kill: walBefore, verify_after_kill: v, new_writer_after_recovery: { committed_txns: r2.committed_txns, error_count: r2.error_count }, verify_after_resume: verifyDb(p) };
  }

  // ---- E. online backup while another process writes ----
  T('E backup()/VACUUM INTO under live writer');
  // isolated in its own process: a native crash (see hazard test) must not take the orchestrator down
  const bk = spawnSync(NODE[0], [NODE[1], join(here, 'backup-suite.mjs'), workDir], { encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26 });
  try { out.E_backup = JSON.parse(bk.stdout); } catch { out.E_backup = { crashed: true, exit: bk.status, signal: bk.signal, stderr: bk.stderr.slice(0, 400) }; }
  return out;
}

export async function runBackupTests(workDir) {
  const res = {};
  const seed = (p, rows = 30000) => {
    freshDb(p);
    const db = new DatabaseSync(p);
    const ins = db.prepare('INSERT INTO events(writer,batch_id,seq,ts,payload) VALUES (?,?,?,?,?)');
    db.exec('BEGIN');
    for (let b = 1; b <= rows / 5; b++) for (let i = 0; i < 5; i++) ins.run(0, b, i, Date.now(), 'p'.repeat(200));
    db.exec('COMMIT');
    db.close();
  };
  const withTimeout = (pr, ms) => Promise.race([pr.then((v) => ({ done: true, v })), new Promise((r) => setTimeout(() => r({ done: false }), ms))]);

  const runCase = async (label, { throttleMs, opts, method = 'backup', timeoutMs = 25000 }) => {
    const src = join(workDir, `bk-${label}.src.db`), dest = join(workDir, `bk-${label}.dest.db`);
    seed(src);
    for (const s of ['', '-wal', '-shm']) rmSync(dest + s, { force: true });
    let wk = null;
    if (throttleMs !== null) {
      const s = startIn(500);
      wk = childKillable('writer.mjs', { db: src, id: 9, startAt: s, endAt: s + 60000, busyTimeout: 5000, throttleMs });
      await new Promise((r) => setTimeout(r, 1200));
    }
    const db = new DatabaseSync(src, { timeout: 5000 });
    let progressCalls = 0, restartsSeen = 0, lastRemaining = Infinity;
    const t0 = performance.now();
    let outcome, ms;
    try {
      if (method === 'backup') {
        const pr = backup(db, dest, { ...opts, progress: ({ totalPages, remainingPages }) => { progressCalls++; if (remainingPages > lastRemaining) restartsSeen++; lastRemaining = remainingPages; } });
        const r = await withTimeout(pr, timeoutMs);
        ms = performance.now() - t0;
        if (r.done) outcome = { completed: true, total_pages: r.v };
        else {
          // gave up waiting under a live writer: stop the writer, then let the backup finish (NEVER db.close() mid-backup: see hazard test)
          outcome = { completed_within_timeout: false, timeout_ms: timeoutMs };
          wk.p.kill('SIGKILL'); await wk.done; wk = null;
          const t1 = performance.now();
          try { const n = await pr; outcome.completed_after_writer_stopped = true; outcome.total_pages = n; outcome.ms_after_writer_stopped = Math.round(performance.now() - t1); outcome.completed = true; }
          catch (e) { outcome.completed_after_writer_stopped = false; outcome.error = e.message; outcome.completed = false; }
        }
      } else {
        db.prepare('VACUUM INTO ?').run(dest);
        outcome = { completed: true };
      }
    } catch (e) { outcome = { completed: false, error: `${e.code} errcode=${e.errcode} ${e.message}` }; }
    ms ??= performance.now() - t0;
    if (wk) { wk.p.kill('SIGKILL'); await wk.done; }
    db.close();
    await new Promise((r) => setTimeout(r, 200));
    let verify = null;
    if (outcome.completed && existsSync(dest)) { try { verify = verifyDb(dest); } catch (e) { verify = { error: e.message }; } }
    return { writer: throttleMs === null ? 'none' : throttleMs === 0 ? 'full-speed' : `${throttleMs}ms throttle`, method, opts: opts ?? {}, ...outcome, elapsed_ms: Math.round(ms), progress_calls: progressCalls, restarts_seen: restartsSeen, verify_copy: verify };
  };

  res.backup_idle = await runCase('idle', { throttleMs: null, opts: {} });
  res.backup_default_rate_writer_fullspeed = await runCase('full', { throttleMs: 0, opts: {}, timeoutMs: 20000 });
  res.backup_default_rate_writer_20ms = await runCase('t20', { throttleMs: 20, opts: {}, timeoutMs: 20000 });
  res.backup_rate_1000_writer_fullspeed = await runCase('r1000', { throttleMs: 0, opts: { rate: 1000 }, timeoutMs: 20000 });
  res.backup_rate_100000_writer_fullspeed = await runCase('r100k', { throttleMs: 0, opts: { rate: 100000 }, timeoutMs: 20000 });
  res.vacuum_into_writer_fullspeed = await runCase('vi', { throttleMs: 0, method: 'vacuum' });
  res.vacuum_into_idle = await runCase('viidle', { throttleMs: null, method: 'vacuum' });
  // hazard: close() the source connection while backup() is still in flight, several attempts (each in its own process)
  const hz = [];
  const hsrc = join(workDir, 'hazard.src.db'); seed(hsrc, 60000);
  for (const mode of ['await', 'close', 'close', 'close', 'close', 'close']) {
    const r = spawnSync(NODE[0], [NODE[1], join(here, 'backup-hazard.mjs'), hsrc, join(workDir, 'hazard.dest.db'), mode], { encoding: 'utf8', timeout: 60000 });
    hz.push({ mode, exit: r.status, signal: r.signal, stdout: r.stdout.trim().slice(0, 100), stderr_head: r.stderr.trim().split('\n')[0]?.slice(0, 100) });
  }
  res.hazard_close_source_while_backup_in_flight = hz;
  return res;
}
