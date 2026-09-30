// Child process: open several DB files read-only and query them continuously; verify snapshot consistency.
// cfg: { dbs: [...], startAt, endAt, batch, timeout }
import { DatabaseSync } from 'node:sqlite';
const cfg = JSON.parse(process.argv[2]);
const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

const conns = cfg.dbs.map((p) => {
  const db = new DatabaseSync(p, { readOnly: true, timeout: cfg.timeout ?? 5000 });
  return { p, db, cnt: db.prepare('SELECT count(*) AS c, max(id) AS m FROM events'),
    torn: db.prepare('SELECT count(*) AS c FROM (SELECT 1 FROM events GROUP BY writer, batch_id HAVING count(*) <> ?)'), last: 0 };
});
sleepSync(cfg.startAt - Date.now());
const lat = [], errors = {};
let reads = 0, monotonicViolations = 0, tornBatches = 0, consistencyChecks = 0, lastCheck = 0;
while (Date.now() < cfg.endAt) {
  for (const c of conns) {
    const t0 = performance.now();
    try {
      const r = c.cnt.get();
      lat.push(performance.now() - t0); reads++;
      if (r.c < c.last) monotonicViolations++;
      c.last = r.c;
      if (Date.now() - lastCheck > 1000) {                           // heavier atomicity check ~1/s
        consistencyChecks++;
        tornBatches += c.torn.get(cfg.batch).c;
      }
    } catch (e) { const k = `errcode=${e.errcode} ${e.message}`; errors[k] = (errors[k] ?? 0) + 1; }
  }
  if (Date.now() - lastCheck > 1000) lastCheck = Date.now();
}
for (const c of conns) c.db.close();
process.stdout.write(JSON.stringify({
  reads, error_count: Object.values(errors).reduce((a, b) => a + b, 0), errors, monotonicViolations, tornBatches, consistencyChecks,
  read_ms: { p50: +pct(lat, 50).toFixed(3), p95: +pct(lat, 95).toFixed(3), p99: +pct(lat, 99).toFixed(3), max: +lat.reduce((m, x) => Math.max(m, x), 0).toFixed(2) },
}));
