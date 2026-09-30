/**
 * run.ts - SP-6 full measurement: `npm run spike` (or `npm run spike:quick`).
 * Prints a JSON summary to stdout; writes results/result.json and results/matrix.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_MODES, DEFAULT_POLICY, describePolicy, withFixes, type AiMode, type MasteryRules, type Transition } from './policy.ts';
import { buildInventory, levelSummary, TRACKS, type TrackId } from './inventory.ts';
import { computeCap, decidePromotion, levelConcepts, structuralFeasibility, type TrackInventory } from './promotion.ts';
import { AGENTS, hashSeed, runCell, type AgentId, type CellResult } from './sim.ts';

const quick = process.argv.includes('--quick');
const N_IDEAL = quick ? 4 : 10;
const N_REAL = quick ? 8 : 30;
const N_RANDOM = quick ? 3 : 6;
const H_IDEAL = 200;
const H_REAL = 240;
const H_RANDOM = 60;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'results');
mkdirSync(outDir, { recursive: true });

/* ---------------------------------------------------------------- combos */
interface Combo { key: string; mode: AiMode; sp1: boolean; label: string }
const COMBOS: Combo[] = [];
for (const mode of AI_MODES) for (const sp1 of [true, false]) COMBOS.push({ key: `${mode}|${sp1 ? 'cal' : 'uncal'}`, mode, sp1, label: `${mode}/${sp1 ? 'SP1pass' : 'SP1fail'}` });
/** LLM_ONLY and OFFLINE never consult Jev, so sp1 is irrelevant by construction (policy functions ignore it). */
const distinctKey = (c: Combo): string => (c.mode === 'LLM_ONLY' || c.mode === 'OFFLINE' ? c.mode : c.key);
const TRANSITIONS: Transition[] = [1, 2, 3, 4];

/* ---------------------------------------------------------------- variants */
const POLICY_A: MasteryRules = DEFAULT_POLICY; // as written in the spec
const POLICY_B: MasteryRules = withFixes(DEFAULT_POLICY, { F1: true, F2: true, F3: true }); // policy-only fixes
const POLICY_C: MasteryRules = withFixes(DEFAULT_POLICY, { F1: true, F3: true, F4: true }); // policy fixes + content Brief

const INV_TARGET = buildInventory();

/** Minimal content Brief: smallest number of extra Tier B `required_for_level` concepts per (track, level) that makes every declared-cap transition feasible in every mode. */
function proposeBrief(policy: MasteryRules): Record<string, number> {
  const brief: Record<string, number> = {};
  for (let pass = 0; pass < 6; pass++) {
    const inv = buildInventory({ brief });
    let changed = false;
    for (const t of TRACKS) {
      for (const k of TRANSITIONS) {
        if (k + 1 > inv[t].declaredCap) continue;
        const bad = COMBOS.some((c) => {
          const f = structuralFeasibility(policy, inv[t], k, c.mode, c.sp1);
          return !f.feasible && f.blockers.some((b) => b.startsWith('NO_ASSESSMENT_POOL') || b.startsWith('NO_DEPTH_ASSET') || b.startsWith('EMPTY_LEVEL'));
        });
        if (bad) {
          const key = `${t}:${k}`;
          brief[key] = (brief[key] ?? 0) + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return brief;
}
const BRIEF = proposeBrief(POLICY_C);
const INV_FIXED = buildInventory({ brief: BRIEF });
const INV_FLOOR = buildInventory({ scenario: 'floor' });
const INV_FLOOR_FIXED = buildInventory({ scenario: 'floor', brief: BRIEF });

/* ---------------------------------------------------------------- helpers */
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (a: number[], q: number): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

type Sym = 'C' | 'P' | 'X' | 'x' | '-';
interface IdealCell { sym: Sym; reachRate: number; medianDay: number | null; blockers: string[]; lastGates: string[]; requiredN?: number }

/* ---------------------------------------------------------------- 1. ideal / realistic matrix */
function runMatrix(
  label: string, policy: MasteryRules, invs: Record<TrackId, TrackInventory>, agentId: AgentId, seeds: number, horizon: number,
): { cells: Record<string, IdealCell>; symbolTable: Record<string, string[]> } {
  const agent = AGENTS[agentId];
  const cache = new Map<string, IdealCell>();
  const cells: Record<string, IdealCell> = {};
  const symbolTable: Record<string, string[]> = {};
  for (const t of TRACKS) {
    for (const c of COMBOS) {
      let row = '';
      for (const k of TRANSITIONS) {
        const id = `${t}|${k}|${c.key}`;
        const ck = `${t}|${k}|${distinctKey(c)}`;
        let cell = cache.get(ck);
        if (!cell) {
          const inv = invs[t];
          if (k + 1 > inv.declaredCap) {
            // policy must refuse (FR-PRG-013 "cap above is never offered")
            const d = decidePromotion(policy, inv, { from: k, mode: c.mode, sp1Calibrated: c.sp1, masteredIds: [], retainedIds: [], d4: [], cases: [], teaching: [], artifacts: [], depthEvidence: 0 });
            cell = { sym: '-', reachRate: 0, medianDay: null, blockers: d.status === 'blocked_cap' ? ['blocked_cap(ok)'] : ['CAP_NOT_ENFORCED'], lastGates: [] };
          } else {
            const f = structuralFeasibility(policy, inv, k, c.mode, c.sp1);
            if (!f.feasible) {
              cell = { sym: 'X', reachRate: 0, medianDay: null, blockers: f.blockers, lastGates: [] };
            } else {
              const rs: CellResult[] = [];
              for (let s = 0; s < seeds; s++) rs.push(runCell({ policy, inv, from: k, mode: c.mode, sp1: c.sp1, agent, seed: hashSeed(`${label}|${agentId}|${ck}|${s}`), horizonDays: horizon }));
              const ok = rs.filter((r) => r.reached);
              const rate = ok.length / seeds;
              const prov = ok.filter((r) => r.provisional).length;
              const sym: Sym = rate >= 0.95 || (agentId !== 'ideal' && rate > 0) ? (prov > ok.length / 2 ? 'P' : 'C') : 'x';
              const lastGates = [...new Set(rs.filter((r) => !r.reached).flatMap((r) => r.lastGates))].slice(0, 3);
              cell = { sym: rate === 0 ? 'x' : sym, reachRate: rate, medianDay: ok.length ? median(ok.map((r) => r.day!)) : null, blockers: [], lastGates, requiredN: levelConcepts(inv, k as 1).required.length };
            }
          }
          cache.set(ck, cell);
        }
        cells[id] = cell;
        row += cell.sym;
      }
      (symbolTable[t] ??= []).push(row);
    }
  }
  return { cells, symbolTable };
}

/* ---------------------------------------------------------------- 2. random guesser / gamer */
interface GuessStats {
  agent: string; policy: string; mode: string; runs: number; conceptsAll: number; concepts30: number;
  /** final theta - theta0 over concept-runs with >=30 events (one session's worth) */
  meanDeltaTheta: number; p95DeltaTheta: number; maxDeltaTheta: number; fracFinalAbove002: number;
  /** transient: highest theta reached at any moment - theta0 (all concept-runs) */
  meanPeakDelta: number; p95PeakDelta: number; maxPeakDelta: number;
  masteredTotal: number; promotions: number; provisionalPromotions: number;
}
function runGuess(agentId: AgentId, policy: MasteryRules, label: string): GuessStats[] {
  const out: GuessStats[] = [];
  for (const mode of AI_MODES) {
    const finals: number[] = [];
    const finals30: number[] = [];
    const peaks: number[] = [];
    let mastered = 0, promotions = 0, prov = 0, runs = 0;
    for (const t of TRACKS) {
      for (const k of TRANSITIONS) {
        for (const sp1 of mode === 'FULL' || mode === 'JUDGE_ONLY' ? [true, false] : [false]) {
          const inv = { ...INV_TARGET[t], declaredCap: 5 as const }; // cap must not hide the learning-side behaviour
          for (let s = 0; s < N_RANDOM; s++) {
            const r = runCell({ policy, inv, from: k, mode, sp1, agent: AGENTS[agentId], seed: hashSeed(`${label}|${agentId}|${t}|${k}|${mode}|${sp1}|${s}`), horizonDays: H_RANDOM });
            runs++;
            finals.push(...(r.thetaDeltas ?? []));
            (r.thetaDeltas ?? []).forEach((d, i) => { if ((r.exposures?.[i] ?? 0) >= 30) finals30.push(d); });
            peaks.push(...(r.maxTheta ?? []));
            mastered += r.masteredCount ?? 0;
            if (r.reached) { promotions++; if (r.provisional) prov++; }
          }
        }
      }
    }
    out.push({
      agent: agentId, policy: label, mode, runs, conceptsAll: finals.length, concepts30: finals30.length,
      meanDeltaTheta: r3(mean(finals30)), p95DeltaTheta: r3(pct(finals30, 0.95)), maxDeltaTheta: r3(Math.max(...finals30)),
      fracFinalAbove002: r3(finals30.filter((x) => x > 0.02).length / finals30.length),
      meanPeakDelta: r3(mean(peaks)), p95PeakDelta: r3(pct(peaks, 0.95)), maxPeakDelta: r3(Math.max(...peaks)),
      masteredTotal: mastered, promotions, provisionalPromotions: prov,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 3. execute */
const t0 = Date.now();
const log = (s: string): void => { process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`); };

const capTable = TRACKS.map((t) => ({
  track: t,
  declared: INV_TARGET[t].declaredCap,
  levels: [1, 2, 3, 4, 5].map((l) => levelSummary(INV_TARGET[t], l as 1)),
  capOffline_asWritten: computeCap(POLICY_A, INV_TARGET[t], 'OFFLINE'),
  capOffline_policyOnly: computeCap(POLICY_B, INV_TARGET[t], 'OFFLINE'),
  capOffline_policyPlusBrief: computeCap(POLICY_C, INV_FIXED[t], 'OFFLINE'),
  capOffline_floorCases: computeCap(POLICY_A, INV_FLOOR[t], 'OFFLINE'),
  capOffline_floorFixed: computeCap(POLICY_C, INV_FLOOR_FIXED[t], 'OFFLINE'),
  capFull_asWritten: computeCap(POLICY_A, INV_TARGET[t], 'FULL', true),
  capJudge_asWritten: computeCap(POLICY_A, INV_TARGET[t], 'JUDGE_ONLY', false),
}));
log('caps computed');

const idealA = runMatrix('A', POLICY_A, INV_TARGET, 'ideal', N_IDEAL, H_IDEAL); log('ideal A');
const idealB = runMatrix('B', POLICY_B, INV_TARGET, 'ideal', N_IDEAL, H_IDEAL); log('ideal B');
const idealC = runMatrix('C', POLICY_C, INV_FIXED, 'ideal', N_IDEAL, H_IDEAL); log('ideal C');
const realA = runMatrix('A', POLICY_A, INV_TARGET, 'realistic', N_REAL, H_REAL); log('realistic A');
const realC = runMatrix('C', POLICY_C, INV_FIXED, 'realistic', N_REAL, H_REAL); log('realistic C');

const naive: MasteryRules = { ...POLICY_A, elo: { ...POLICY_A.elo, guessCorrection: false }, version: `${POLICY_A.version}+naiveElo` };
const noBias: MasteryRules = { ...POLICY_A, weights: { ...POLICY_A.weights, selfBias: { enabled: false, slope: 0 } }, version: `${POLICY_A.version}+noSelfBias` };
const fixF4: MasteryRules = withFixes(DEFAULT_POLICY, { F4: true });
const fixF4half: MasteryRules = { ...fixF4, elo: { ...fixF4.elo, unqualifiedCeiling: 0.5 }, version: `${fixF4.version}(ceiling=0.5)` };
const guessRows: GuessStats[] = [
  ...runGuess('random', POLICY_A, 'A(guessCorrection=on)'),
  ...runGuess('random', naive, 'naiveElo(guessCorrection=off)'),
  ...runGuess('random_ox', POLICY_A, 'A(guessCorrection=on)'),
  ...runGuess('random_ox', naive, 'naiveElo(guessCorrection=off)'),
  ...runGuess('gamer_pure', POLICY_A, 'A(selfBias=on)'),
  ...runGuess('gamer_pure', noBias, 'noSelfBias'),
  ...runGuess('gamer_pure', fixF4, 'A+F4(unqualifiedCeiling=0)'),
  ...runGuess('gamer_pure', fixF4half, 'A+F4(unqualifiedCeiling=0.5, sensitivity)'),
  ...runGuess('gamer_seq', POLICY_A, 'A(selfBias=on)'),
  ...runGuess('gamer_seq', noBias, 'noSelfBias'),
  ...runGuess('gamer_seq', fixF4, 'A+F4(unqualifiedCeiling=0)'),
];
log('guessers');

/* ---------------------------------------------------------------- 3b. analytic CBM sensitivity */
function binom(n: number, k: number): number { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
/** P(pass) of a 12-item assessment for a learner with true accuracy p who always answers with C3 (best case) or C2. */
function cbmPassProb(p: number, conf: 2 | 3, min: number): number {
  let pr = 0;
  for (let wrong = 0; wrong <= 12; wrong++) {
    const pts = conf === 3 ? 3 * (12 - wrong) - 6 * wrong : 2 * (12 - wrong) - 2 * wrong;
    if (pts / 36 >= min - 1e-9) pr += binom(12, wrong) * (1 - p) ** wrong * p ** (12 - wrong);
  }
  return pr;
}
const cbmSensitivity = [0.8, 0.85, 0.9, 0.92, 0.95, 0.97].map((p) => ({
  accuracy: p,
  passC3_70: r3(cbmPassProb(p, 3, 0.7)), passC3_75: r3(cbmPassProb(p, 3, 0.75)),
  passC2_70: r3(cbmPassProb(p, 2, 0.7)),
  attemptsFor95_L1toL4: Math.ceil(Math.log(0.05) / Math.log(Math.max(1e-9, 1 - cbmPassProb(p, 3, 0.7)))),
}));
const neededMasteredTable = [3, 4, 5, 6, 7, 8, 10, 12, 20].map((n) => ({ n, need: Math.ceil(n * 0.85 - 1e-9), effectivePct: Math.round((Math.ceil(n * 0.85 - 1e-9) / n) * 100) }));

/* ---------------------------------------------------------------- 4. summaries */
function count(cells: Record<string, IdealCell>, sym: Sym): number { return Object.values(cells).filter((c) => c.sym === sym).length; }
function inCap(cells: Record<string, IdealCell>): number { return Object.values(cells).filter((c) => c.sym !== '-').length; }
function unreachable(cells: Record<string, IdealCell>): { key: string; blockers: string[]; lastGates: string[]; sym: Sym }[] {
  return Object.entries(cells).filter(([, c]) => c.sym === 'X' || c.sym === 'x').map(([key, c]) => ({ key, sym: c.sym, blockers: c.blockers, lastGates: c.lastGates }));
}
/** Collapse the (track, transition) unreachable list over combos. */
function collapse(cells: Record<string, IdealCell>): Record<string, { combos: string[]; blockers: string[] }> {
  const m: Record<string, { combos: string[]; blockers: string[] }> = {};
  for (const [key, c] of Object.entries(cells)) {
    if (c.sym !== 'X' && c.sym !== 'x') continue;
    const [t, k, mode, cal] = key.split('|');
    const id = `${t}:T${k}`;
    (m[id] ??= { combos: [], blockers: [] }).combos.push(`${mode}/${cal}`);
    for (const b of c.blockers.length ? c.blockers : c.lastGates) if (!m[id]!.blockers.includes(b)) m[id]!.blockers.push(b);
  }
  return m;
}
function realisticAgg(cells: Record<string, IdealCell>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mode of AI_MODES) for (const k of TRANSITIONS) {
    const cs = Object.entries(cells).filter(([key, c]) => key.split('|')[1] === String(k) && key.split('|')[2] === mode && (c.sym !== '-' && c.sym !== 'X'));
    const rates = cs.map(([, c]) => c.reachRate);
    const days = cs.filter(([, c]) => c.medianDay !== null).map(([, c]) => c.medianDay!);
    out[`${mode}|T${k}`] = { cells: cs.length, meanReachRate: r3(mean(rates)), minReachRate: r3(Math.min(...rates)), medianDay: median(days), p90Day: pct(days, 0.9) };
  }
  return out;
}

function worst(cells: Record<string, IdealCell>): unknown[] {
  const seen = new Set<string>();
  const rows: { cell: string; rate: number; requiredN?: number; medianDay: number | null }[] = [];
  for (const [key, c] of Object.entries(cells)) {
    if (c.sym === '-' || c.sym === 'X') continue;
    const [t, k, mode, cal] = key.split('|');
    const dk = `${t}|${k}|${mode === 'LLM_ONLY' || mode === 'OFFLINE' ? mode : mode + cal}`;
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push({ cell: dk, rate: r3(c.reachRate), requiredN: c.requiredN, medianDay: c.medianDay });
  }
  return rows.sort((a, b) => a.rate - b.rate).slice(0, 10);
}

const summary = {
  spike: 'SP-6', node: process.version, quick, seeds: { ideal: N_IDEAL, realistic: N_REAL, random: N_RANDOM },
  horizons: { ideal: H_IDEAL, realistic: H_REAL, random: H_RANDOM },
  policyVersion: POLICY_A.version,
  brief: BRIEF,
  cap: capTable.map((c) => ({ track: c.track, declared: c.declared, offlineAsWritten: c.capOffline_asWritten, offlinePolicyOnly: c.capOffline_policyOnly, offlinePolicyPlusBrief: c.capOffline_policyPlusBrief, offlineFloorCases: c.capOffline_floorCases, offlineFloorFixed: c.capOffline_floorFixed, fullAsWritten: c.capFull_asWritten, judgeAsWritten: c.capJudge_asWritten })),
  ideal: {
    asWritten: { cellsInCap: inCap(idealA.cells), C: count(idealA.cells, 'C'), P: count(idealA.cells, 'P'), unreachable: count(idealA.cells, 'X') + count(idealA.cells, 'x'), beyondCap: count(idealA.cells, '-'), unreachableList: collapse(idealA.cells) },
    policyOnly: { cellsInCap: inCap(idealB.cells), C: count(idealB.cells, 'C'), P: count(idealB.cells, 'P'), unreachable: count(idealB.cells, 'X') + count(idealB.cells, 'x'), beyondCap: count(idealB.cells, '-'), unreachableList: collapse(idealB.cells) },
    policyPlusBrief: { cellsInCap: inCap(idealC.cells), C: count(idealC.cells, 'C'), P: count(idealC.cells, 'P'), unreachable: count(idealC.cells, 'X') + count(idealC.cells, 'x'), beyondCap: count(idealC.cells, '-'), unreachableList: collapse(idealC.cells) },
  },
  realistic: {
    asWritten: realisticAgg(realA.cells), policyPlusBrief: realisticAgg(realC.cells),
    worstAsWritten: worst(realA.cells),
  },
  guessers: guessRows,
  cbmSensitivity,
  neededMasteredTable,
  elapsedSec: r3((Date.now() - t0) / 1000),
};

/* ---------------------------------------------------------------- 5. markdown matrices */
function mdMatrix(title: string, sym: Record<string, string[]>): string {
  const head = `| track | ${COMBOS.map((c) => c.label).join(' | ')} |`;
  const sep = `|---|${COMBOS.map(() => '---').join('|')}|`;
  const rows = TRACKS.map((t) => `| ${t} | ${sym[t]!.join(' | ')} |`);
  return `### ${title}\n\n${head}\n${sep}\n${rows.join('\n')}\n`;
}
const md = [
  '# SP-6 matrices (generated by `npm run spike`)',
  'Cell = 4 symbols for transitions T1(L1>L2) T2(L2>L3) T3(L3>L4) T4(L4>L5). `C` reached, confirmed | `P` reached, provisional | `X` structurally unreachable | `x` not reached in horizon | `-` beyond cap (policy refuses).',
  mdMatrix('Ideal learner, policy as written', idealA.symbolTable),
  mdMatrix('Ideal learner, policy-only fixes F1+F2+F3', idealB.symbolTable),
  mdMatrix('Ideal learner, policy F1+F3 + content Brief', idealC.symbolTable),
  mdMatrix('Realistic learner, policy as written (any seed reached)', realA.symbolTable),
  mdMatrix('Realistic learner, policy F1+F3+F4 + content Brief', realC.symbolTable),
].join('\n');

writeFileSync(join(outDir, 'result.json'), JSON.stringify({
  summary, policy: describePolicy(POLICY_A), capTable,
  idealAsWritten: idealA.cells, idealPolicyOnly: idealB.cells, idealPolicyPlusBrief: idealC.cells,
  realisticAsWritten: realA.cells, realisticPolicyPlusBrief: realC.cells,
}, null, 1));
writeFileSync(join(outDir, 'matrix.md'), md);
process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
