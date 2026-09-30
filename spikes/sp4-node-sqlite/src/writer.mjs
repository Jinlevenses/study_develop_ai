// Child process: hammer one SQLite file with small write transactions until endAt; print a JSON report on stdout.
// cfg: { db, id, startAt, endAt, busyTimeout, begin: 'IMMEDIATE'|'DEFERRED_UPGRADE', batch, sync, throttleMs, holdMs, holdAtMs }
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(process.argv[2]);
const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

const db = new DatabaseSync(cfg.db, { timeout: cfg.busyTimeout ?? 5000 });   // `timeout` option == PRAGMA busy_timeout
db.exec(`PRAGMA synchronous=${cfg.sync ?? 'NORMAL'}`);
const payload = 'x'.repeat(180) + String(cfg.id).padEnd(20, '.');
const ins = db.prepare('INSERT INTO events(writer, batch_id, seq, ts, payload) VALUES (?,?,?,?,?)');
const rd = db.prepare('SELECT max(id) AS m FROM events');
const batch = cfg.batch ?? 5;

const errors = {}, errWaitMs = [], lat = [];
let ok = 0, rows = 0, batchNo = 0, holdDone = false;
sleepSync(cfg.startAt - Date.now());
const t00 = Date.now();

function classify(e) {
  const base = (e.errcode ?? 0) & 0xff;
  const name = base === 5 ? 'SQLITE_BUSY' : base === 6 ? 'SQLITE_LOCKED' : `SQLITE_${base}`;
  return `${name}(errcode=${e.errcode}${e.errstr ? ',' + e.errstr : ''})`;
}

while (Date.now() < cfg.endAt) {
  const t0 = performance.now();
  try {
    db.exec(cfg.begin === 'DEFERRED_UPGRADE' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    if (cfg.begin === 'DEFERRED_UPGRADE') rd.get();          // take a read snapshot first, then try to upgrade to writer
    const b = batchNo + 1;
    for (let i = 0; i < batch; i++) ins.run(cfg.id, b, i, Date.now(), payload);
    if (cfg.holdMs && !holdDone && Date.now() - t00 >= (cfg.holdAtMs ?? 0)) { holdDone = true; sleepSync(cfg.holdMs); } // long write txn
    db.exec('COMMIT');
    batchNo = b;
    ok++; rows += batch; lat.push(performance.now() - t0);
  } catch (e) {
    const k = classify(e) + ' ' + e.message;
    errors[k] = (errors[k] ?? 0) + 1;
    errWaitMs.push(performance.now() - t0);
    try { db.exec('ROLLBACK'); } catch { /* no txn open */ }
  }
  if (cfg.throttleMs) sleepSync(cfg.throttleMs);
}
const secs = (Date.now() - t00) / 1000;
db.close();
process.stdout.write(JSON.stringify({
  id: cfg.id, seconds: +secs.toFixed(2), committed_txns: ok, rows, txn_per_s: +(ok / secs).toFixed(1),
  errors, error_count: Object.values(errors).reduce((a, b) => a + b, 0),
  err_wait_ms: { max: +errWaitMs.reduce((m, x) => Math.max(m, x), 0).toFixed(1), p50: +pct(errWaitMs, 50).toFixed(1) },
  commit_ms: { p50: +pct(lat, 50).toFixed(3), p95: +pct(lat, 95).toFixed(3), p99: +pct(lat, 99).toFixed(3), max: +lat.reduce((m, x) => Math.max(m, x), 0).toFixed(2) },
}));
