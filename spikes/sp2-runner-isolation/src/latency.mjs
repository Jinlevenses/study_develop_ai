import { spawn } from 'node:child_process';
import { run, prewarm, runOnSpare, RUN_ROOT } from './runner.mjs';
import fs from 'node:fs';

const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]; };
const stats = (arr) => ({ n: arr.length, p50: +pct(arr, 0.5).toFixed(1), p95: +pct(arr, 0.95).toFixed(1), max: +Math.max(...arr).toFixed(1), mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) });

const TYPICAL_JS = `import assert from 'node:assert/strict';
function fib(n){return n<2?n:fib(n-1)+fib(n-2)}
const twoSum=(a,t)=>{const m=new Map();for(let i=0;i<a.length;i++){if(m.has(t-a[i]))return [m.get(t-a[i]),i];m.set(a[i],i)}};
assert.equal(fib(22),17711); assert.deepEqual(twoSum([2,7,11,15],9),[0,1]);
console.log(JSON.stringify({pass:2,total:2}));`;
const TYPICAL_TS = `import assert from 'node:assert/strict';
type Pair = [number, number];
function fib(n: number): number { return n < 2 ? n : fib(n-1) + fib(n-2); }
const twoSum = (a: number[], t: number): Pair | undefined => { const m = new Map<number, number>(); for (let i = 0; i < a.length; i++) { if (m.has(t - a[i])) return [m.get(t - a[i])!, i]; m.set(a[i], i); } };
assert.equal(fib(22), 17711); assert.deepEqual(twoSum([2,7,11,15], 9), [0,1]);
console.log(JSON.stringify({ pass: 2, total: 2 }));`;
const TYPICAL_SQL = `CREATE TABLE emp(id INTEGER PRIMARY KEY, dept TEXT, sal INT);
INSERT INTO emp(dept,sal) VALUES ('a',100),('a',200),('b',150),('b',300),('c',50);
SELECT dept, sal, RANK() OVER (PARTITION BY dept ORDER BY sal DESC) AS r, AVG(sal) OVER (PARTITION BY dept) AS avg FROM emp ORDER BY dept, r;`;

async function seq(n, fn) { const t = []; for (let i = 0; i < n; i++) t.push(await fn(i)); return t; }

function bareNode(args) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const c = spawn(process.execPath, args, { stdio: 'ignore', env: {} });
    c.on('close', () => resolve(performance.now() - t0));
  });
}

export async function runLatency(log = () => {}, N = 50) {
  const out = {};
  const check = (r, what) => { if (r.status !== 'ok') throw new Error(`latency scenario ${what} failed: ${r.status} ${r.stderr.slice(0, 200)}`); return r.durationMs; };
  log('baseline node -e 0');
  await bareNode(['-e', '0']);
  out.bare_node_startup = stats(await seq(N, () => bareNode(['-e', '0'])));
  log('js hello (full sandbox)');
  const first = await run({ code: 'console.log(1+1)' });   // include true first-run in a separate number
  out.first_run_ms = first.durationMs;
  out.js_hello_full = stats(await seq(N, async () => check(await run({ code: 'console.log(1+1)' }), 'js_hello')));
  log('js typical (full)');
  out.js_typical_full = stats(await seq(N, async () => check(await run({ code: TYPICAL_JS }), 'js_typical')));
  log('js hello (permission only, no guard)');
  out.js_hello_permission_only = stats(await seq(N, async () => check(await run({ code: 'console.log(1+1)', layers: 'permission' }), 'perm')));
  log('ts typical (full)');
  out.ts_typical_full = stats(await seq(N, async () => check(await run({ code: TYPICAL_TS, lang: 'ts' }), 'ts')));
  log('sql typical (full)');
  out.sql_typical_full = stats(await seq(N, async () => check(await run({ kind: 'sql', code: TYPICAL_SQL }), 'sql')));
  log('one-shot prewarmed spare (js typical)');
  const warm = [];
  for (let i = 0; i < N; i++) {
    const sp = prewarm();
    await new Promise((r) => setTimeout(r, 250)); // spare boots in the background while the "user thinks"
    const r = await runOnSpare(sp, TYPICAL_JS);
    warm.push(check(r, 'warm'));
  }
  out.js_typical_prewarmed_spare = stats(warm);
  log('concurrency 4');
  const conc = []; let idx = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (idx < N) { idx++; conc.push(check(await run({ code: TYPICAL_JS }), 'conc')); } }));
  out.js_typical_full_concurrency4 = stats(conc);
  out.tmp_root_entries_after = fs.existsSync(RUN_ROOT) ? fs.readdirSync(RUN_ROOT).length : 0;
  return out;
}
