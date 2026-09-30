// Experiment: strip TS types in the PARENT (module.stripTypeScriptTypes) and run the result as plain .mjs in the child.
import { stripTypeScriptTypes } from 'node:module';
import { run } from './runner.mjs';
const TS = `import assert from 'node:assert/strict';
type Pair = [number, number];
function fib(n: number): number { return n < 2 ? n : fib(n-1) + fib(n-2); }
const twoSum = (a: number[], t: number): Pair | undefined => { const m = new Map<number, number>(); for (let i = 0; i < a.length; i++) { if (m.has(t - a[i])) return [m.get(t - a[i])!, i]; m.set(a[i], i); } };
assert.equal(fib(22), 17711); assert.deepEqual(twoSum([2,7,11,15], 9), [0,1]);
console.log(JSON.stringify({ pass: 2, total: 2 }));`;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.ceil(p * s.length) - 1]; };
process.removeAllListeners('warning'); process.on('warning', () => {});
const t0 = performance.now(); const first = stripTypeScriptTypes(TS); const firstMs = performance.now() - t0;
const strip = []; const total = [];
for (let i = 0; i < 50; i++) {
  const a = performance.now(); const js = stripTypeScriptTypes(TS); const b = performance.now();
  const r = await run({ code: js, lang: 'js' }); const c = performance.now();
  if (r.status !== 'ok') throw new Error(r.stderr);
  strip.push(b - a); total.push(c - a);
}
let bad = null; try { stripTypeScriptTypes('enum E{A}'); } catch (e) { bad = e.code; }
console.log(JSON.stringify({ firstStripMs: +firstMs.toFixed(1), stripP50: +pct(strip, .5).toFixed(2), stripP95: +pct(strip, .95).toFixed(2), totalP50: +pct(total, .5).toFixed(1), totalP95: +pct(total, .95).toFixed(1), enumInStripMode: bad, sample: first.slice(0, 60) }));
