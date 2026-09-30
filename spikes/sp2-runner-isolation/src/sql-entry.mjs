// Trusted SQL executor, runs INSIDE the sandboxed child (same flags as the JS runner, FATHOM_MODE=sql).
// Input: <cwd>/query.sql. Output: one JSON line on stdout. Learner SQL is DATA here, never code.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { checkSql, firstKeyword } from './sql-tokenizer.mjs';

const ROW_CAP = 1000;
const CELL_CAP = 1024;
const sqlPath = process.argv[2];
const noTokenizer = process.argv[3] === '--unsafe-no-tokenizer'; // only used by the spike's positive-control test
const out = { ok: true, results: [], error: null };
const t0 = performance.now();
try {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const stmts = noTokenizer ? [sql] : checkSql(sql).statements; // defence in depth: parent already checked
  const db = new DatabaseSync(':memory:', { allowExtension: false, enableForeignKeyConstraints: true });
  // Runner-owned pragmas (bypass the learner allowlist deliberately): cap DB size and SQLite heap.
  db.exec('PRAGMA max_page_count = 4096');       // 4096 * 4KB = 16MB in-memory DB
  db.exec('PRAGMA hard_heap_limit = 134217728'); // 128MB SQLite heap (best effort, see report)
  for (const s of stmts) {
    const kw = firstKeyword(s);
    if (noTokenizer) { db.exec(s); out.results.push({ kw: 'RAW' }); continue; }
    const stmt = db.prepare(s);
    if (kw === 'SELECT' || kw === 'WITH' || kw === 'PRAGMA') {
      const rows = [];
      let truncated = false;
      for (const r of stmt.iterate()) {
        if (rows.length >= ROW_CAP) { truncated = true; break; }
        const o = {};
        for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'string' && v.length > CELL_CAP ? v.slice(0, CELL_CAP) + '…' : typeof v === 'bigint' ? String(v) : v instanceof Uint8Array ? `<blob ${v.length}B>` : v;
        rows.push(o);
      }
      out.results.push({ kw, rows, truncated });
    } else {
      const r = stmt.run();
      out.results.push({ kw, changes: Number(r.changes) });
    }
  }
  db.close();
} catch (e) {
  out.ok = false;
  out.error = { code: e.code ?? null, message: String(e.message).slice(0, 300) };
}
out.ms = +(performance.now() - t0).toFixed(2);
process.stdout.write(JSON.stringify(out) + '\n');
