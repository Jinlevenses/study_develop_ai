/**
 * inventory.ts - concept/Case inventory of the 19 core tracks, derived from the planning docs.
 *
 * Sources
 *   R4 section 5.22 (concepts per track x level), CNV section 9.3 (Tier A per track x level, cap table),
 *   CNV section 9.2 (Tier B composition: 50 core-L1 + 42 path-L2 + 24 path-L3 + 4 eng-L2 = 120),
 *   CNV section 9.4 (pool sizes), CNV section 9.5 (Case list with track tags and floor marks).
 * ASSUMPTIONS (the docs give only totals for Tier B): Tier B is spread over tracks in proportion to the
 *   room left after Tier A (largest remainder). A real pack must replace this with `required_for_level`.
 */
import type { FormatId, Level, Tier } from './policy.ts';
import type { CaseRef, ConceptRef, TrackInventory } from './promotion.ts';

export const TRACKS = [
  'alg', 'cs', 'net', 'lang', 'fe', 'be', 'db', 'linux', 'docker', 'k8s',
  'cicd', 'sre', 'cloud', 'sec', 'ml', 'llm', 'arch', 'eng', 'lead',
] as const;
export type TrackId = (typeof TRACKS)[number];

/** R4 5.22 concept counts, L1..L5. */
const COUNTS: Record<TrackId, number[]> = {
  alg: [8, 8, 7, 4, 2], cs: [4, 6, 6, 5, 2], net: [5, 7, 8, 4, 2], lang: [4, 6, 8, 3, 2], fe: [5, 8, 9, 3, 2],
  be: [4, 7, 9, 5, 1], db: [2, 8, 7, 6, 3], linux: [5, 8, 7, 1, 1], docker: [5, 8, 4, 2, 1], k8s: [7, 7, 7, 5, 2],
  cicd: [2, 6, 8, 4, 1], sre: [1, 4, 8, 5, 2], cloud: [4, 5, 7, 4, 1], sec: [4, 5, 9, 7, 2], ml: [3, 6, 7, 6, 1],
  llm: [3, 7, 10, 5, 2], arch: [0, 2, 7, 11, 6], eng: [5, 12, 5, 1, 1], lead: [3, 3, 5, 5, 4],
};

/** CNV 9.3 Tier A per track x level. */
const TIER_A: Record<TrackId, number[]> = {
  alg: [1, 1, 1, 0, 0], cs: [1, 1, 1, 0, 0], net: [1, 1, 1, 0, 0], lang: [1, 1, 1, 0, 0], fe: [1, 1, 1, 0, 0],
  be: [1, 1, 1, 1, 0], db: [1, 1, 1, 1, 1], linux: [1, 1, 1, 0, 0], docker: [1, 1, 1, 0, 0], k8s: [1, 1, 1, 1, 0],
  cicd: [1, 1, 1, 0, 0], sre: [1, 1, 1, 2, 1], cloud: [1, 1, 1, 0, 0], sec: [1, 1, 1, 2, 1], ml: [1, 1, 1, 0, 0],
  llm: [1, 1, 1, 1, 1], arch: [0, 1, 1, 2, 1], eng: [1, 1, 1, 0, 0], lead: [1, 0, 0, 2, 1],
};

/** CNV 9.3 declared cap (target inventory). */
export const DECLARED_CAP: Record<TrackId, Level> = {
  alg: 4, cs: 4, net: 4, lang: 4, fe: 4, linux: 4,
  be: 5, db: 5, docker: 5, k8s: 5, cicd: 5, sre: 5, cloud: 5, sec: 5, ml: 5, llm: 5, arch: 5, eng: 5, lead: 5,
};

const PATH_TRACKS: TrackId[] = ['llm', 'be', 'fe', 'db', 'docker', 'k8s', 'cicd', 'ml'];

/** CNV 9.5, all 30 Cases. floor = the 12 marked with a dot. */
const CASES: CaseRef[] = [
  { id: 1, level: 3, tracks: ['k8s', 'sre', 'db'], floor: true },
  { id: 2, level: 3, tracks: ['be', 'db', 'sre'], floor: true },
  { id: 3, level: 3, tracks: ['docker', 'cicd'], floor: true },
  { id: 4, level: 3, tracks: ['fe', 'sre'], floor: false },
  { id: 5, level: 3, tracks: ['llm', 'ml'], floor: true },
  { id: 6, level: 3, tracks: ['net', 'k8s'], floor: true },
  { id: 7, level: 3, tracks: ['sec', 'be'], floor: true },
  { id: 8, level: 3, tracks: ['cicd', 'eng'], floor: false },
  { id: 9, level: 4, tracks: ['db', 'sre'], floor: true },
  { id: 10, level: 4, tracks: ['arch', 'be', 'net'], floor: false },
  { id: 11, level: 4, tracks: ['arch', 'be', 'sre'], floor: false },
  { id: 12, level: 4, tracks: ['k8s', 'sre', 'cicd'], floor: true },
  { id: 13, level: 4, tracks: ['cloud', 'sec'], floor: true },
  { id: 14, level: 4, tracks: ['llm', 'cloud', 'arch'], floor: false },
  { id: 15, level: 4, tracks: ['arch', 'be', 'lead'], floor: false },
  { id: 16, level: 5, tracks: ['eng', 'lead', 'sec'], floor: true },
  { id: 17, level: 5, tracks: ['arch', 'cloud', 'db', 'sre'], floor: false },
  { id: 18, level: 5, tracks: ['cicd', 'k8s', 'docker', 'lead'], floor: false },
  { id: 19, level: 5, tracks: ['db', 'be', 'sre'], floor: true },
  { id: 20, level: 4, tracks: ['cloud', 'sre', 'lead'], floor: false },
  { id: 21, level: 5, tracks: ['sec', 'cicd', 'eng'], floor: false },
  { id: 22, level: 5, tracks: ['lead', 'arch'], floor: false },
  { id: 23, level: 5, tracks: ['lead', 'arch', 'eng'], floor: false },
  { id: 24, level: 4, tracks: ['sec', 'db', 'eng'], floor: false },
  { id: 25, level: 4, tracks: ['cicd', 'sec', 'cloud'], floor: false },
  { id: 26, level: 5, tracks: ['llm', 'ml', 'sre'], floor: false },
  { id: 27, level: 4, tracks: ['alg', 'lang', 'be'], floor: false },
  { id: 28, level: 4, tracks: ['fe', 'arch'], floor: false },
  { id: 29, level: 4, tracks: ['linux', 'cs', 'docker', 'k8s'], floor: true },
  { id: 30, level: 4, tracks: ['ml', 'llm'], floor: false },
];

/** Largest-remainder allocation of `total` over `capacity` (never above capacity). */
function allocate(capacity: Record<string, number>, total: number): Record<string, number> {
  const keys = Object.keys(capacity);
  const cap = keys.reduce((s, k) => s + capacity[k]!, 0);
  const out: Record<string, number> = {};
  const rem: { k: string; r: number }[] = [];
  let used = 0;
  for (const k of keys) {
    const exact = (capacity[k]! * total) / cap;
    out[k] = Math.min(capacity[k]!, Math.floor(exact));
    used += out[k]!;
    rem.push({ k, r: exact - Math.floor(exact) });
  }
  rem.sort((a, b) => b.r - a.r || (a.k < b.k ? -1 : 1));
  for (const { k } of rem) {
    if (used >= total) break;
    if (out[k]! < capacity[k]!) {
      out[k]!++;
      used++;
    }
  }
  return out;
}

/** Tier B per track x level (CNV 9.2 composition). */
export function tierBAllocation(): Record<TrackId, number[]> {
  const B: Record<TrackId, number[]> = {} as Record<TrackId, number[]>;
  for (const t of TRACKS) B[t] = [0, 0, 0, 0, 0];
  const l1cap: Record<string, number> = {};
  for (const t of TRACKS) l1cap[t] = COUNTS[t][0]! - TIER_A[t][0]!;
  const l1 = allocate(l1cap, 50);
  for (const t of TRACKS) B[t][0] = l1[t]!;
  const l2cap: Record<string, number> = {};
  for (const t of PATH_TRACKS) l2cap[t] = COUNTS[t][1]! - TIER_A[t][1]!;
  const l2 = allocate(l2cap, 42);
  for (const t of PATH_TRACKS) B[t][1] = l2[t]!;
  for (const t of PATH_TRACKS) B[t][2] = Math.min(3, COUNTS[t][2]! - TIER_A[t][2]!); // 3 required candidates per path track
  B.eng[1] = 4; // SI deliverable L2
  return B;
}

const COND_REV_TRACKS = new Set<string>(['arch', 'db', 'be', 'sre', 'llm', 'cloud', 'k8s', 'docker', 'cicd']);
const KATA_TRACKS = new Set<string>(['lang', 'fe', 'be', 'db', 'docker', 'k8s', 'cicd']);
const INFRA_TRACKS = new Set<string>(['docker', 'k8s', 'cicd']);

type Pool = Partial<Record<FormatId, number>>;

/**
 * Authored + T2 pool per concept. Totals follow CNV 9.4: Tier A ~ 12 authored + ~24 T2 = 36, Tier B ~ 5 + ~15 = 20.
 * Tier C has no authored items (skeleton only) -> empty pool unless AI generates on demand.
 */
export function conceptPool(tier: Tier, track: string): Pool {
  if (tier === 'A') {
    const p: Pool = {
      embedded: 2, ox: 12, mcq: 7, cloze: 9, short: 1, matching: 4, code_task: 2, blank_note: 1, digging_d4_mcq: 2,
      confusable: 3, error_find: 3, audit: 3,
    };
    if (COND_REV_TRACKS.has(track)) { p.fermi = 2; p.cond_reversal = 2; }
    if (KATA_TRACKS.has(track)) p.kata = 2;
    if (INFRA_TRACKS.has(track)) p.infra_lite = 3;
    return p;
  }
  if (tier === 'B') return { embedded: 1, ox: 7, mcq: 3, cloze: 6, matching: 4, blank_note: 1 };
  return {};
}

/** Pool that an LLM-capable mode can materialise for a Tier C concept (assumed = Tier B grade, gated). */
export function generatedPool(): Pool {
  return { ox: 7, mcq: 3, cloze: 6, matching: 4 };
}

export interface InventoryOptions {
  /** 'target' = full inventory; 'floor' = only the 12 floor Cases (Tier A/B kept at target; floor Tier A list is unpublished). */
  scenario?: 'target' | 'floor';
  /** Extra Tier B concepts added by content Briefs: `${track}:${level}` -> count. */
  brief?: Record<string, number>;
}

export function buildInventory(opts: InventoryOptions = {}): Record<TrackId, TrackInventory> {
  const B = tierBAllocation();
  const out = {} as Record<TrackId, TrackInventory>;
  const cases = opts.scenario === 'floor' ? CASES.filter((c) => c.floor) : CASES;
  for (const t of TRACKS) {
    const concepts: ConceptRef[] = [];
    for (let li = 0; li < 5; li++) {
      const level = (li + 1) as Level;
      const total = COUNTS[t][li]!;
      const a = TIER_A[t][li]!;
      const briefB = opts.brief?.[`${t}:${level}`] ?? 0;
      const b = B[t][li]!;
      // Content Brief converts Tier C -> Tier B (or adds new concepts if none left).
      const extraB = Math.min(briefB, Math.max(0, total - a - b));
      const added = briefB - extraB;
      const n = total + added;
      for (let i = 0; i < n; i++) {
        const tier: Tier = i < a ? 'A' : i < a + b + extraB ? 'B' : 'C';
        concepts.push({ id: `${t}.L${level}.${i + 1}`, level, tier, pool: conceptPool(tier, t) });
      }
    }
    out[t] = {
      id: t,
      concepts,
      cases: cases.filter((c) => c.tracks.includes(t)),
      artifactTasks: 12, // [ASSUME] artifact seeds (ADR/standard/postmortem/runbook) are generic across tracks
      declaredCap: DECLARED_CAP[t],
      generatedPool: generatedPool(),
    };
  }
  return out;
}

/** Per-level summary used by the report. */
export function levelSummary(inv: TrackInventory, level: Level): { total: number; A: number; B: number; C: number } {
  const cs = inv.concepts.filter((c) => c.level === level);
  return {
    total: cs.length,
    A: cs.filter((c) => c.tier === 'A').length,
    B: cs.filter((c) => c.tier === 'B').length,
    C: cs.filter((c) => c.tier === 'C').length,
  };
}
