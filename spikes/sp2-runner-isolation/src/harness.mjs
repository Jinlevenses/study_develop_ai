// Attack harness: runs every attack in 3 layers (none / permission / full) where safe, and checks HOST-SIDE effects.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import dgram from 'node:dgram';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, RUN_ROOT } from './runner.mjs';
import { attacks, sqlAttacks } from './attacks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leftoverProcs() {
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cmd.includes(RUN_ROOT + '/run-') && /(^|\/)(node|prlimit)\0/.test(cmd)) found.push(+pid);
    } catch {}
  }
  return found.filter((p) => p !== process.pid);
}

export async function startServices() {
  const hits = { tcp: 0, http: 0, udp: 0, sigusr2: 0, sigusr1: 0 };
  const tcp = net.createServer((s) => { hits.tcp++; s.on('error', () => {}); s.destroy(); });
  const srv = http.createServer((req, res) => { hits.http++; res.end('x'); });
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => { hits.udp++; });
  await new Promise((r) => tcp.listen(0, '127.0.0.1', r));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  process.on('SIGUSR2', () => { hits.sigusr2++; });
  process.on('SIGUSR1', () => { hits.sigusr1++; });
  return { hits, ports: { tcp: tcp.address().port, http: srv.address().port, udp: udp.address().port }, close: () => { tcp.close(); srv.close(); udp.close(); } };
}

export function makeCtx(ports) {
  const secretName = 'FATHOM_TEST_SECRET';
  const secretValue = 'SECRET-' + crypto.randomBytes(8).toString('hex');
  process.env[secretName] = secretValue; // lives in the PARENT env only; children get an empty env
  const fakeHome = path.join(FIX, 'fakehome');
  const outside = path.join(FIX, 'outside');
  fs.mkdirSync(path.join(fakeHome, '.ssh'), { recursive: true });
  const sshCanary = 'CANARY-SSH-KEY-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(fakeHome, '.ssh', 'id_rsa'), sshCanary);
  fs.mkdirSync(outside, { recursive: true });
  return { fakeHome, outside, realHome: os.homedir(), runRoot: RUN_ROOT, tcpPort: ports.tcp, httpPort: ports.http, udpPort: ports.udp, secretName, secretValue, sshCanary };
}

function cleanOutside(ctx) {
  for (const f of fs.readdirSync(ctx.outside)) fs.rmSync(path.join(ctx.outside, f), { recursive: true, force: true });
  for (const f of ['pwn-rel.txt', 'pwn-dir', 'outside-of-tmp.txt']) fs.rmSync(path.join(RUN_ROOT, f), { recursive: true, force: true });
}

function hostEffects(ctx, svc, res, before) {
  const eff = [];
  const outsideFiles = fs.readdirSync(ctx.outside);
  if (outsideFiles.length) eff.push('file created outside: ' + outsideFiles.join(','));
  for (const f of ['pwn-rel.txt', 'pwn-dir', 'outside-of-tmp.txt']) if (fs.existsSync(path.join(RUN_ROOT, f))) eff.push('file created in RUN_ROOT: ' + f);
  for (const k of ['tcp', 'http', 'udp', 'sigusr2', 'sigusr1']) if (svc.hits[k] > before[k]) eff.push(`${k} hit x${svc.hits[k] - before[k]}`);
  const text = (res.stdout || '') + (res.stderr || '');
  if (text.includes(ctx.secretValue)) eff.push('parent secret leaked in output');
  if (text.includes(ctx.sshCanary)) eff.push('ssh canary leaked in output');
  if (/root:[x*]:0:0/.test(text)) eff.push('/etc/passwd content leaked');
  for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 20 && /TOKEN|SECRET|KEY/i.test(k) && text.includes(v)) eff.push('real env secret leaked: ' + k);
  const esc = (res.stdout || '').split('\n').filter((l) => l.startsWith('ESCAPED:'));
  if (esc.length) eff.push('ESCAPED marker x' + esc.length + ': ' + esc.slice(0, 3).join(' | ').slice(0, 160));
  return eff;
}

function blockedCodes(stdout) {
  const m = {};
  for (const l of (stdout || '').split('\n')) if (l.startsWith('BLOCKED:')) m[l.slice(8)] = (m[l.slice(8)] || 0) + 1;
  return m;
}

async function one(a, ctx, svc, layers, extra = {}) {
  cleanOutside(ctx);
  const before = { ...svc.hits };
  const opts = { code: a.code, lang: a.lang ?? 'js', layers, ...(a.opts ?? {}), ...extra };
  if (layers === 'none') { opts.timeoutMs = Math.min(opts.timeoutMs ?? 3000, 3000); }
  const res = await run(opts);
  await sleep(120);
  const eff = hostEffects(ctx, svc, res, before);
  const left = leftoverProcs();
  if (left.length) { eff.push('LEFTOVER PROCESSES: ' + left.join(',')); for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch {} } }
  cleanOutside(ctx);
  return { status: res.status, ms: res.durationMs, peakRssMB: res.peakRssMB, tmpCleaned: res.tmpCleaned, escaped: eff.length > 0, effects: eff, blocked: blockedCodes(res.stdout), stderrHead: (res.stderr || '').split('\n').find((l) => /Error|ERR_/.test(l))?.slice(0, 120) ?? '' };
}

export async function runAttacks(log = () => {}) {
  const svc = await startServices();
  const ctx = makeCtx(svc.ports);
  const out = [];
  for (const a of attacks(ctx)) {
    const row = { id: a.id, cat: a.cat, name: a.name };
    if (a.resource) {
      const r = await one(a, ctx, svc, 'full');
      const okStatus = (a.expect ?? []).includes(r.status);
      const overshoot = r.peakRssMB > 512;
      row.full = r; row.pass = okStatus && !r.escaped && r.tmpCleaned && !overshoot;
      row.note = `expected ${JSON.stringify(a.expect)} got ${r.status}; peakRSS ${r.peakRssMB}MB; ${r.ms}ms`;
    } else if (a.accepted) {
      const r = await one(a, ctx, svc, 'full');
      row.full = r; row.accepted = true; row.pass = true; row.note = `forged stdout is delivered as-is (status ${r.status}); documented as RSK-RUN (grader must not trust learner stdout)`;
    } else {
      const effKey = (a.allowOk ? 'allowOk' : '');
      const none = await one(a, ctx, svc, 'none', a.controlOpts ? { env: a.controlOpts.env } : {});
      const perm = await one(a, ctx, svc, 'permission', a.controlOpts ? { env: a.controlOpts.env } : {});
      const full = await one(a, ctx, svc, 'full');
      row.none = { escaped: none.escaped, effects: none.effects }; row.permission = { escaped: perm.escaped, effects: perm.effects };
      row.full = full;
      row.pass = !full.escaped && full.tmpCleaned;
      row.controlValid = none.escaped || perm.escaped; // attack is demonstrably real in a weaker layer
      void effKey;
    }
    out.push(row);
    log(`${row.pass ? 'PASS' : 'FAIL'} ${row.id} ${row.name}` + (row.none ? `  [none:${row.none.escaped ? 'ESC' : 'safe'} perm:${row.permission.escaped ? 'ESC' : 'safe'} full:${row.full.escaped ? 'ESC' : 'safe'}]` : `  ${row.note ?? ''}`));
  }
  svc.close();
  return { rows: out, ctx };
}

export async function runSqlAttacks(log = () => {}) {
  const svc = await startServices();
  const ctx = makeCtx(svc.ports);
  const out = [];
  for (const a of sqlAttacks(ctx)) {
    cleanOutside(ctx);
    const res = await run({ kind: 'sql', code: a.sql, ...(a.opts ?? {}) });
    const files = fs.readdirSync(ctx.outside);
    let parsed = null; try { parsed = JSON.parse(res.stdout.trim().split('\n').pop()); } catch {}
    const row = { id: a.id, name: a.name, status: res.status, reason: res.reason ?? parsed?.error?.message ?? null, ms: res.durationMs, peakRssMB: res.peakRssMB, filesCreated: files };
    if (a.expect) {
      row.pass = a.expect.includes(res.status) && files.length === 0 && (!a.expectTruncated || parsed?.results?.[0]?.truncated === true);
      if (a.expectTruncated) row.rowsReturned = parsed?.results?.[0]?.rows?.length;
    } else row.pass = res.status === 'rejected' && files.length === 0;
    if (a.fileCheck) {
      cleanOutside(ctx);
      const c2 = await run({ kind: 'sql', code: a.sql, unsafeNoTokenizer: true });
      row.control_noTokenizer = { status: c2.status, fileCreated: fs.existsSync(path.join(ctx.outside, a.fileCheck)) };
      cleanOutside(ctx);
    }
    row.leftover = leftoverProcs().length;
    out.push(row);
    log(`${row.pass ? 'PASS' : 'FAIL'} ${a.id} ${a.name} -> ${row.status}${row.reason ? ' (' + String(row.reason).slice(0, 70) + ')' : ''}${row.control_noTokenizer ? ' [control: file ' + (row.control_noTokenizer.fileCreated ? 'CREATED' : 'not created') + ']' : ''}`);
  }
  // Functional (false-positive) checks
  const fn = [];
  const cases = [
    ['window function', `CREATE TABLE s(g TEXT, v INT); INSERT INTO s VALUES ('a',1),('a',3),('b',2); SELECT g, v, SUM(v) OVER (PARTITION BY g ORDER BY v) AS run FROM s ORDER BY g, v`, (r) => JSON.stringify(r.results[2].rows) === JSON.stringify([{ g: 'a', v: 1, run: 1 }, { g: 'a', v: 3, run: 4 }, { g: 'b', v: 2, run: 2 }])],
    ['recursive CTE', `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<5) SELECT sum(x) AS s FROM c`, (r) => r.results[0].rows[0].s === 15],
    ['DDL/DML/drop', `CREATE TABLE t(a); CREATE INDEX i ON t(a); CREATE VIEW v AS SELECT a FROM t; INSERT INTO t VALUES (1),(2); UPDATE t SET a=a+1; DELETE FROM t WHERE a=2; SELECT * FROM v; DROP VIEW v; DROP INDEX i; DROP TABLE t`, (r) => r.results[6].rows[0].a === 3],
    ['safe PRAGMA table_info', `CREATE TABLE t(a INT, b TEXT); PRAGMA table_info(t)`, (r) => r.results[1].rows.length === 2],
    ['string containing keyword', `SELECT 'attach pragma vacuum' AS s, "attach" FROM (SELECT 1 AS "attach")`, (r) => r.results[0].rows[0].s === 'attach pragma vacuum'],
    ['SQLite syntax error is reported, runner does not crash', `SELECT FROM WHERE 1`, (r) => r.ok === false && /syntax/i.test(r.error.message)],
    ['row cap 1000', `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<5000) SELECT x FROM c`, (r) => r.results[0].rows.length === 1000 && r.results[0].truncated],
  ];
  for (const [name, sql, check] of cases) {
    const res = await run({ kind: 'sql', code: sql });
    let parsed = null; try { parsed = JSON.parse(res.stdout.trim().split('\n').pop()); } catch {}
    let ok = false; try { ok = !!parsed && check(parsed); } catch {}
    fn.push({ name, ok, status: res.status, ms: res.durationMs });
    log(`${ok ? 'PASS' : 'FAIL'} functional: ${name} (${res.durationMs}ms)`);
  }
  // Contrast: `node:sqlite` layers actually measured (allowExtension:false; load_extension without tokenizer)
  const le = await run({ kind: 'sql', code: `SELECT load_extension('/lib/x86_64-linux-gnu/libc.so.6')`, unsafeNoTokenizer: true });
  svc.close();
  return { rows: out, functional: fn, loadExtensionRawStdout: le.stdout.slice(0, 200), loadExtensionRawStderr: le.stderr.slice(0, 200), ctx };
}
