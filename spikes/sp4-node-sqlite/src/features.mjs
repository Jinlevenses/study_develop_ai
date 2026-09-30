import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sqlite from 'node:sqlite';
const { DatabaseSync, StatementSync } = sqlite;

const err = (e) => ({ error: `${e.code ?? e.name}${e.errcode !== undefined ? ' errcode=' + e.errcode : ''}${e.errstr ? ' (' + e.errstr + ')' : ''}: ${e.message}` });
const t = (fn) => { try { return fn(); } catch (e) { return err(e); } };
const ta = async (fn) => { try { return await fn(); } catch (e) { return err(e); } };
const rate = (n, ms) => Math.round(n / (ms / 1000));

export async function runFeatures(workDir) {
  const dir = join(workDir, 'features');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = {};
  const mem = () => new DatabaseSync(':memory:');

  // ---------- versions / surface ----------
  {
    const db = mem();
    const opts = db.prepare('PRAGMA compile_options').all().map((r) => r.compile_options);
    out.surface = {
      node: process.version,
      sqlite_version: db.prepare('SELECT sqlite_version() v').get().v,
      module_exports: Object.keys(sqlite),
      constants: Object.keys(sqlite.constants ?? {}),
      DatabaseSync_prototype: Object.getOwnPropertyNames(DatabaseSync.prototype).filter((k) => k !== 'constructor'),
      StatementSync_prototype: Object.getOwnPropertyNames(StatementSync.prototype).filter((k) => k !== 'constructor'),
      compile_options_interesting: opts.filter((o) => /FTS|JSON|THREADSAFE|MAX_ATTACHED|MATH|DBSTAT|LOAD_EXTENSION|SECURE_DELETE|DEFAULT_WAL|STAT4|SOUNDEX|SESSION|PREUPDATE|MAX_LENGTH|DEFAULT_MEMSTATUS/.test(o)),
      compile_options_count: opts.length,
      has_isOpen: 'isOpen' in db, has_isTransaction: 'isTransaction' in db,
      has_Symbol_dispose: typeof db[Symbol.dispose] === 'function',
      generate_series_available: (() => { try { db.prepare('SELECT * FROM generate_series(1,2)').all(); return true; } catch (e) { return e.message; } })(),
      has_columns: typeof db.prepare('select 1').columns === 'function',
    };
    db.close();
  }

  // ---------- constructor options ----------
  {
    const p = join(dir, 'opts.db');
    const o = {};
    o.timeout_option_readback = t(() => { const d = new DatabaseSync(p, { timeout: 4321 }); const v = d.prepare('PRAGMA busy_timeout').get(); d.close(); return v; });
    o.default_busy_timeout = t(() => { const d = new DatabaseSync(p); const v = d.prepare('PRAGMA busy_timeout').get(); d.close(); return v; });
    o.open_false_then_open = t(() => { const d = new DatabaseSync(p, { open: false }); const before = t(() => d.exec('select 1')); d.open(); const after = d.prepare('select 1 as x').get(); d.close(); return { before_open_call: before, after_open: after }; });
    o.enableForeignKeyConstraints_default = t(() => { const d = new DatabaseSync(p); const v = d.prepare('PRAGMA foreign_keys').get(); d.close(); return v; });
    o.enableForeignKeyConstraints_false = t(() => { const d = new DatabaseSync(p, { enableForeignKeyConstraints: false }); const v = d.prepare('PRAGMA foreign_keys').get(); d.close(); return v; });
    o.enableDoubleQuotedStringLiterals_default = t(() => { const d = mem(); return d.prepare('SELECT "abc" AS x').get(); });
    o.enableDoubleQuotedStringLiterals_true = t(() => { const d = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); return d.prepare('SELECT "abc" AS x').get(); });
    o.readBigInts_option = t(() => { const d = new DatabaseSync(':memory:', { readBigInts: true }); return typeof d.prepare('SELECT 1 AS x').get().x; });
    o.returnArrays_option = t(() => { const d = new DatabaseSync(':memory:', { returnArrays: true }); return d.prepare('SELECT 1 AS x, 2 AS y').get(); });
    o.allowExtension_default_load = t(() => { const d = mem(); return d.loadExtension('/nonexistent.so'); });
    o.allowExtension_true_enable = t(() => { const d = new DatabaseSync(':memory:', { allowExtension: true }); d.enableLoadExtension(true); return 'enableLoadExtension ok'; });
    o.unknown_option_ignored = t(() => { const d = new DatabaseSync(':memory:', { definitelyNotAnOption: 1 }); return 'silently accepted'; });
    out.constructor_options = o;
  }

  // ---------- statements: reuse, params, result shapes ----------
  {
    const db = mem();
    db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, v REAL, b BLOB)');
    const r = {};
    const ins = db.prepare('INSERT INTO t(name,v,b) VALUES (?,?,?)');
    r.run_result = ins.run('a', 1.5, new Uint8Array([1, 2, 3]));
    r.run_result_types = { changes: typeof r.run_result.changes, lastInsertRowid: typeof r.run_result.lastInsertRowid };
    r.get_blob_type = db.prepare('SELECT b FROM t').get().b?.constructor?.name;
    r.get_no_row = db.prepare('SELECT * FROM t WHERE id=99').get();
    r.all_shape = db.prepare('SELECT id,name FROM t').all();
    r.iterate = [...db.prepare('SELECT id FROM t').iterate()];
    const named = db.prepare('SELECT $a AS a, :b AS b, @c AS c');
    r.named_params_with_prefix = named.get({ $a: 1, ':b': 2, '@c': 3 });
    r.named_params_bare = t(() => named.get({ a: 1, b: 2, c: 3 }));
    r.unknown_named_param = t(() => named.get({ a: 1, b: 2, c: 3, zzz: 9 }));
    r.sourceSQL = named.sourceSQL;
    r.columns = t(() => db.prepare('SELECT id AS i, name FROM t').columns());
    r.bigint_out_of_range = t(() => db.prepare('SELECT 9007199254740993 AS x').get());
    r.bigint_with_setReadBigInts = t(() => { const s = db.prepare('SELECT 9007199254740993 AS x'); s.setReadBigInts(true); return String(s.get().x); });
    r.bigint_param = t(() => db.prepare('SELECT ? AS x').get(2n ** 62n));
    r.undefined_param = t(() => db.prepare('SELECT ? AS x').get(undefined));
    r.boolean_param = t(() => db.prepare('SELECT ? AS x').get(true));
    r.date_param = t(() => db.prepare('SELECT ? AS x').get(new Date()));
    r.object_null_prototype_rows = Object.getPrototypeOf(db.prepare('SELECT 1 a').get()) === null;
    r.multi_statement_prepare = t(() => { const s = db.prepare('SELECT 1 AS a; SELECT 2 AS a'); return s.all(); });
    r.exec_multi_statement = t(() => { db.exec('CREATE TABLE m1(a); CREATE TABLE m2(a); INSERT INTO m1 VALUES (1);'); return 'ok'; });
    r.finalized_after_close = t(() => { const d = mem(); const s = d.prepare('select 1'); d.close(); return s.get(); });
    r.double_close = t(() => { const d = mem(); d.close(); d.close(); return 'no error'; });
    out.statements = r;
    db.close();
  }

  // ---------- performance: prepared reuse vs re-prepare ----------
  {
    const db = mem();
    db.exec('CREATE TABLE p(id INTEGER PRIMARY KEY, v INTEGER); WITH RECURSIVE g(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM g WHERE value<1000) INSERT INTO p SELECT value, value FROM g');
    const N = 100000, perf = {};
    let t0 = performance.now(); const s = db.prepare('SELECT v FROM p WHERE id=?');
    for (let i = 0; i < N; i++) s.get((i % 1000) + 1);
    perf.select_reused_stmt_ops_per_s = rate(N, performance.now() - t0);
    t0 = performance.now();
    for (let i = 0; i < N; i++) db.prepare('SELECT v FROM p WHERE id=?').get((i % 1000) + 1);
    perf.select_reprepare_each_time_ops_per_s = rate(N, performance.now() - t0);
    const db2 = mem(); db2.exec('CREATE TABLE q(id INTEGER PRIMARY KEY, a TEXT, b INTEGER)');
    const ins = db2.prepare('INSERT INTO q(a,b) VALUES (?,?)');
    t0 = performance.now(); db2.exec('BEGIN'); for (let i = 0; i < 200000; i++) ins.run('row' + i, i); db2.exec('COMMIT');
    perf.insert_200k_in_one_txn_rows_per_s = rate(200000, performance.now() - t0);
    const db3 = new DatabaseSync(join(dir, 'autocommit.db')); db3.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE q(id INTEGER PRIMARY KEY, a TEXT)');
    const ins3 = db3.prepare('INSERT INTO q(a) VALUES (?)');
    t0 = performance.now(); for (let i = 0; i < 5000; i++) ins3.run('row' + i); 
    perf.file_wal_normal_autocommit_inserts_per_s = rate(5000, performance.now() - t0);
    db3.close();
    out.performance = perf;
    db.close(); db2.close();
  }

  // ---------- transactions ----------
  {
    const db = mem();
    db.exec('CREATE TABLE a(x INTEGER PRIMARY KEY)');
    const r = {};
    db.exec('BEGIN'); db.exec('INSERT INTO a VALUES (1)'); db.exec('ROLLBACK');
    r.rollback_keeps_zero_rows = db.prepare('SELECT count(*) c FROM a').get().c;
    r.nested_begin_error = t(() => { db.exec('BEGIN'); try { db.exec('BEGIN'); } finally { db.exec('ROLLBACK'); } });
    db.exec('BEGIN'); db.exec('INSERT INTO a VALUES (2)'); db.exec('SAVEPOINT sp1'); db.exec('INSERT INTO a VALUES (3)'); db.exec('ROLLBACK TO sp1'); db.exec('RELEASE sp1'); db.exec('COMMIT');
    r.savepoint_rollback_rows = db.prepare('SELECT x FROM a ORDER BY x').all().map((z) => z.x);
    r.begin_immediate_supported = t(() => { db.exec('BEGIN IMMEDIATE'); db.exec('COMMIT'); return true; });
    r.constraint_error_detail = t(() => db.prepare('INSERT INTO a VALUES (2)').run());
    r.isTransaction_property = db.isTransaction;   // undefined on 22.22 if the getter does not exist yet
    // recommended helper (works without db.isTransaction)
    const tx = (d, fn, mode = 'IMMEDIATE') => { d.exec(`BEGIN ${mode}`); try { const v = fn(); d.exec('COMMIT'); return v; } catch (e) { try { d.exec('ROLLBACK'); } catch {} throw e; } };
    r.tx_helper_commit = tx(db, () => db.prepare('INSERT INTO a VALUES (10)').run().changes);
    r.tx_helper_rollback = t(() => tx(db, () => { db.prepare('INSERT INTO a VALUES (11)').run(); throw new Error('boom'); }));
    r.rows_after_helper = db.prepare('SELECT x FROM a ORDER BY x').all().map((z) => z.x);
    out.transactions = r;
    db.close();
  }

  // ---------- user functions / aggregates ----------
  {
    const db = mem();
    const r = {};
    r.function_basic = t(() => { db.function('add2', (a, b) => a + b); return db.prepare('SELECT add2(2,3) AS x').get(); });
    r.function_deterministic_in_index = t(() => { db.function('nfc', { deterministic: true }, (s) => (s == null ? null : String(s).normalize('NFC'))); db.exec('CREATE TABLE u(s TEXT); CREATE INDEX u_nfc ON u(nfc(s))'); return 'expression index on deterministic user function ok'; });
    r.function_varargs = t(() => { db.function('cat', { varargs: true }, (...a) => a.join('|')); return db.prepare("SELECT cat('a','b','c') AS x").get(); });
    r.function_regexp_operator = t(() => { db.function('regexp', { deterministic: true }, (pat, s) => (new RegExp(pat, 'u').test(s) ? 1 : 0)); return db.prepare("SELECT 'k8s-pod' REGEXP '^k8s' AS x").get(); });
    r.function_korean_choseong_like = t(() => {
      db.function('hangul_initials', { deterministic: true }, (s) => [...String(s)].map((c) => { const n = c.charCodeAt(0) - 0xac00; return n >= 0 && n <= 11171 ? 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(n / 588)] : c; }).join(''));
      return db.prepare("SELECT hangul_initials('쿠버네티스 파드') AS x").get();
    });
    r.function_throwing = t(() => { db.function('boom', () => { throw new Error('user fn failed'); }); return db.prepare('SELECT boom() AS x').get(); });
    r.function_bigint_arg = t(() => { db.function('big', { useBigIntArguments: true }, (a) => typeof a); return db.prepare('SELECT big(5) AS x').get(); });
    r.aggregate_exists = typeof db.aggregate;
    r.aggregate_sumsq = t(() => { db.aggregate('sumsq', { start: 0, step: (acc, v) => acc + v * v, result: (acc) => acc }); return db.prepare('SELECT sumsq(value) AS x FROM (SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3)').get(); });
    r.aggregate_window_inverse = t(() => { db.aggregate('wsum', { start: 0, step: (a, v) => a + v, inverse: (a, v) => a - v, result: (a) => a }); return db.prepare('SELECT wsum(v) OVER (ORDER BY v ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS x FROM (SELECT 1 v UNION ALL SELECT 2 UNION ALL SELECT 3)').all().map((z) => z.x); });
    out.user_functions = r;
    db.close();
  }

  // ---------- JSON / STRICT / SQL feature probes ----------
  {
    const db = mem();
    const r = {};
    db.exec(`CREATE TABLE ev(id INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK (json_valid(data))) STRICT`);
    db.prepare('INSERT INTO ev(data) VALUES (?)').run(JSON.stringify({ kind: 'review', grade: 3, tags: ['a', 'b'], nested: { k: 1 } }));
    r.json_extract = db.prepare("SELECT json_extract(data,'$.grade') AS g, data->>'$.kind' AS k, data->'$.tags' AS tags FROM ev").get();
    r.json_each = db.prepare("SELECT value FROM ev, json_each(ev.data,'$.tags')").all().map((z) => z.value);
    r.json_group_array = db.prepare("SELECT json_group_array(json_extract(data,'$.grade')) AS x FROM ev").get();
    r.jsonb = t(() => db.prepare("SELECT typeof(jsonb('{\"a\":1}')) AS t, json(jsonb('{\"a\":1}')) AS j").get());
    r.json_valid_check_rejects = t(() => db.prepare('INSERT INTO ev(data) VALUES (?)').run('{not json'));
    r.json_index_expression = t(() => { db.exec("CREATE INDEX ev_kind ON ev(json_extract(data,'$.kind'))"); return db.prepare("EXPLAIN QUERY PLAN SELECT id FROM ev WHERE json_extract(data,'$.kind')='review'").all().map((z) => z.detail).join('|'); });
    r.strict_text_into_integer = t(() => { db.exec('CREATE TABLE s(n INTEGER, t TEXT, a ANY) STRICT'); return db.prepare('INSERT INTO s(n,t,a) VALUES (?,?,?)').run('abc', 'x', 1); });
    r.strict_numeric_string_coerced = t(() => { db.prepare('INSERT INTO s(n,t,a) VALUES (?,?,?)').run('42', 'x', 'anything'); return db.prepare('SELECT n, typeof(n) AS tn FROM s').get(); });
    r.strict_bad_column_type = t(() => db.exec('CREATE TABLE s2(x VARCHAR(10)) STRICT'));
    r.strict_boolean_hint = 'STRICT allows only INT/INTEGER/REAL/TEXT/BLOB/ANY; store booleans as INTEGER with CHECK(x IN (0,1))';
    const probe = (name, sql) => { r[name] = t(() => { const x = db.prepare(sql); return x.all(); }); };
    db.exec('CREATE TABLE IF NOT EXISTS rr(id INTEGER PRIMARY KEY, v TEXT UNIQUE)');
    probe('returning_clause', "INSERT INTO rr(v) VALUES ('zz') RETURNING id");
    probe('upsert', "INSERT INTO rr(v) VALUES ('a') ON CONFLICT(v) DO UPDATE SET v=excluded.v RETURNING id, v");
    probe('window_function', 'SELECT id, row_number() OVER (ORDER BY id) AS rn FROM rr');
    probe('recursive_cte', 'WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n<5) SELECT sum(n) AS s FROM c');
    r.generated_column = t(() => { db.exec('CREATE TABLE gc(a INTEGER, b INTEGER GENERATED ALWAYS AS (a*2) VIRTUAL) STRICT; INSERT INTO gc(a) VALUES (21)'); return db.prepare('SELECT b FROM gc').get(); });
    r.math_functions = t(() => db.prepare('SELECT ln(exp(2)) AS a, pow(2,10) AS b, sqrt(16) AS c, log10(1000) AS d').get());
    r.unixepoch_subsec = t(() => db.prepare("SELECT unixepoch('now','subsec') > 0 AS ok").get());
    r.iif_and_ifnull = t(() => db.prepare('SELECT iif(1<2,\'y\',\'n\') AS a').get());
    r.attach_other_file = t(() => { const p2 = join(dir, 'attach.db'); const d = new DatabaseSync(p2); d.exec('CREATE TABLE z(a)'); d.close(); db.exec(`ATTACH DATABASE '${p2}' AS other`); return db.prepare('SELECT count(*) c FROM other.z').get(); });
    r.pragma_user_version = t(() => { db.exec('PRAGMA user_version=7'); return db.prepare('PRAGMA user_version').get(); });
    r.pragma_application_id = t(() => { db.exec('PRAGMA application_id=0x46415448'); return db.prepare('PRAGMA application_id').get(); });
    out.sql_features = r;
    db.close();
  }

  // ---------- readOnly ----------
  {
    const r = {};
    const p = join(dir, 'ro.db');
    const d = new DatabaseSync(p); d.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(a); INSERT INTO t VALUES (1)'); d.close();
    r.wal_files_after_clean_close = { wal: existsSync(p + '-wal'), shm: existsSync(p + '-shm') };
    const ro = new DatabaseSync(p, { readOnly: true });
    r.read_ok = ro.prepare('SELECT count(*) c FROM t').get();
    r.write_error = t(() => ro.exec('INSERT INTO t VALUES (2)'));
    r.pragma_query_only_like = t(() => ro.exec('CREATE TABLE x(a)'));
    r.journal_mode_seen = ro.prepare('PRAGMA journal_mode').get();
    ro.close();
    r.open_missing_file_readOnly = t(() => new DatabaseSync(join(dir, 'missing.db'), { readOnly: true }));
    r.open_missing_file_default_creates = t(() => { const q = join(dir, 'created.db'); const x = new DatabaseSync(q); x.exec('CREATE TABLE a(b)'); x.close(); return existsSync(q); });
    r.readOnly_while_writer_open_in_wal = t(() => {
      const w = new DatabaseSync(p); w.exec('INSERT INTO t VALUES (3)');
      const rr = new DatabaseSync(p, { readOnly: true }); const c = rr.prepare('SELECT count(*) c FROM t').get(); rr.close(); w.close(); return c;
    });
    out.read_only = r;
  }

  // ---------- backup API ----------
  {
    const r = {};
    const src = join(dir, 'bk-src.db'), dest = join(dir, 'bk-dest.db');
    const d = new DatabaseSync(src); d.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(a); WITH RECURSIVE g(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM g WHERE value<5000) INSERT INTO t SELECT value FROM g');
    r.exported = typeof sqlite.backup;
    r.result_type = await ta(async () => { const n = await sqlite.backup(d, dest); return { resolved_with: n, type: typeof n }; });
    r.progress_callback = await ta(async () => { const calls = []; const n = await sqlite.backup(d, dest + '2', { rate: 5, progress: (p) => calls.push(p) }); return { resolved_with: n, calls: calls.length, first: calls[0], last: calls[calls.length - 1] }; });
    r.dest_verify = t(() => { const x = new DatabaseSync(dest); const v = { count: x.prepare('SELECT count(*) c FROM t').get().c, integrity: x.prepare('PRAGMA integrity_check').get().integrity_check }; x.close(); return v; });
    r.dest_journal_mode = t(() => { const x = new DatabaseSync(dest); const v = x.prepare('PRAGMA journal_mode').get(); x.close(); return v; });
    r.dest_as_database_object = await ta(async () => sqlite.backup(d, new DatabaseSync(':memory:')));
    r.vacuum_into = t(() => { const v = join(dir, 'vac.db'); rmSync(v, { force: true }); d.prepare('VACUUM INTO ?').run(v); const x = new DatabaseSync(v); const c = x.prepare('SELECT count(*) c FROM t').get().c; x.close(); return { rows: c }; });
    r.vacuum_into_existing_file = t(() => d.prepare('VACUUM INTO ?').run(join(dir, 'vac.db')));
    d.close();
    out.backup_api = r;
  }

  // ---------- session / changeset (relevant for multi-device merge FR-SET-022) ----------
  {
    const r = {};
    r.session = t(() => {
      const a = mem(), b = mem();
      for (const x of [a, b]) x.exec('CREATE TABLE e(id INTEGER PRIMARY KEY, v TEXT)');
      const s = a.createSession();
      a.exec("INSERT INTO e VALUES (1,'x'),(2,'y')");
      const cs = s.changeset();
      const ok = b.applyChangeset(cs);
      return { changeset_bytes: cs.length, applied: ok, rows_in_b: b.prepare('SELECT count(*) c FROM e').get().c };
    });
    out.session_changeset = r;
  }

  // ---------- path handling (Windows concerns are doc-only; this checks what Linux can) ----------
  {
    const r = {};
    const kdir = join(dir, '한글 경로 with space', '데이터');
    mkdirSync(kdir, { recursive: true });
    r.korean_and_space_path = t(() => { const p = join(kdir, '학습 기록.db'); const d = new DatabaseSync(p); d.exec('PRAGMA journal_mode=WAL; CREATE TABLE a(b); INSERT INTO a VALUES (1)'); d.close(); return { ok: true, size: statSync(p).size }; });
    r.url_object_path = t(() => { const p = join(dir, 'url.db'); const d = new DatabaseSync(pathToFileURL(p)); d.exec('CREATE TABLE a(b)'); d.close(); return existsSync(p); });
    r.buffer_path = t(() => { const p = join(dir, 'buf.db'); const d = new DatabaseSync(Buffer.from(p)); d.exec('CREATE TABLE a(b)'); d.close(); return existsSync(p); });
    r.file_uri_string_mode_ro = t(() => { const p = join(dir, 'uri.db'); const d0 = new DatabaseSync(p); d0.exec('CREATE TABLE a(b)'); d0.close(); const d = new DatabaseSync('file:' + p + '?mode=ro'); const w = t(() => d.exec('INSERT INTO a VALUES (1)')); d.close(); return { opened: true, write_result: w }; });
    r.relative_path = t(() => { const d = new DatabaseSync(join('.work', 'features', 'rel.db')); d.exec('CREATE TABLE a(b)'); d.close(); return existsSync(join('.work', 'features', 'rel.db')); });
    r.long_path_300_chars = t(() => { const long = join(dir, 'x'.repeat(100), 'y'.repeat(100), 'z'.repeat(100)); mkdirSync(long, { recursive: true }); const p = join(long, 'db.sqlite'); const d = new DatabaseSync(p); d.exec('CREATE TABLE a(b)'); d.close(); return { path_length: p.length, ok: true }; });
    r.location_method = t(() => { const d = new DatabaseSync(join(dir, 'loc.db')); const l = d.location(); d.close(); return l; });
    r.location_memory = t(() => { const d = mem(); return d.location(); });
    out.paths_on_linux = r;
  }
  return out;
}
