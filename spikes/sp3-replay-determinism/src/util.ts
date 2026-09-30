import { createHash } from 'node:crypto';

export const DAY = 86_400_000;

/** sfc32 PRNG seeded through splitmix32 — fully deterministic, clonable state. */
export class Rng {
  s: [number, number, number, number];
  private spare: number | null = null;
  constructor(seed: number | [number, number, number, number]) {
    if (Array.isArray(seed)) { this.s = [...seed] as any; return; }
    let x = seed >>> 0;
    const sm = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s = [sm(), sm(), sm(), sm()];
    for (let i = 0; i < 12; i++) this.next();
  }
  next(): number {
    let [a, b, c, d] = this.s;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    this.s = [a, b, c, d];
    return t / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
  normal(): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
  clone(): Rng { const r = new Rng(this.s); r.spare = this.spare; return r; }
}

export function mixSeed(...xs: number[]): number {
  let h = 2166136261 >>> 0;
  for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h = (h ^ (h >>> 15)) >>> 0; }
  return h;
}

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Monotonic ULID factory. Random part comes from the (seeded) Rng so tests are reproducible.
 *  Production must use crypto.randomBytes for the 80-bit random part. */
export class UlidGen {
  private lastTime = -1;
  private rnd: number[] = new Array(16).fill(0);
  constructor(private rng: Rng) {}
  next(ts: number): string {
    if (ts <= this.lastTime) {
      ts = this.lastTime;
      let i = 15;
      while (i >= 0) { if (this.rnd[i] === 31) { this.rnd[i] = 0; i--; } else { this.rnd[i]++; break; } }
    } else {
      for (let i = 0; i < 16; i++) this.rnd[i] = this.rng.int(32);
      this.lastTime = ts;
    }
    let t = ts, tp = '';
    for (let i = 0; i < 10; i++) { tp = ENC[t % 32] + tp; t = Math.floor(t / 32); }
    let rp = '';
    for (let i = 0; i < 16; i++) rp += ENC[this.rnd[i]];
    return tp + rp;
  }
  snapshot() { return { lastTime: this.lastTime, rnd: [...this.rnd] }; }
  restore(s: { lastTime: number; rnd: number[] }) { this.lastTime = s.lastTime; this.rnd = [...s.rnd]; }
}

export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const GENESIS = '0'.repeat(32);

export function pctl(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return NaN;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[i];
}
export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
