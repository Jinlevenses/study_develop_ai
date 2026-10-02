// R-POOL · cap 인벤토리(Brief T-01-03 §4.6). 판정은 반드시 @fathom/contracts/pack/feasibility의 structuralFeasibility() 호출(재구현 0).

import type { FormatId } from '@fathom/contracts/common/domain';
import { AiMode } from '@fathom/contracts/common/domain';
import type { TrackId } from '@fathom/contracts/common/ids';
import type { FeasibilityBlocker } from '@fathom/contracts/common/practice';
import type { AssessmentInventory } from '@fathom/contracts/pack/feasibility';
import { structuralFeasibility } from '@fathom/contracts/pack/feasibility';
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import type { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import type { z } from 'zod';
import type { Item } from '../parse/schema/item.js';
import type { ConceptFile, Indexes } from '../validate/model.js';

type AiModeT = z.infer<typeof AiMode>;
type FormatIdT = z.infer<typeof FormatId>;
type TrackIdT = z.infer<typeof TrackId>;
type Mastery = z.infer<typeof MasteryRulesV1>;
type Method = z.infer<typeof MethodPolicyV1>;
type Blocker = z.infer<typeof FeasibilityBlocker>;
type Inventory = z.infer<typeof AssessmentInventory>;

export const MODES = AiMode.options;
const LEVEL_KEYS = ['1', '2', '3', '4', '5'] as const;
const TRANSITIONS = [
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4 },
  { from: 4, to: 5 },
] as const;

/** V4 미구현이라 출제 0인 문항: code_predict의 answer: 'auto'. */
export function isDeferredItem(item: Item): boolean {
  return item.format === 'code_predict' && item.answer === 'auto';
}

/** 형식 산입: formats[f].credit_eligible ∧ (mode = OFFLINE → grade_class === 'D'). */
export function eligible(method: Method, format: FormatIdT, mode: AiModeT): boolean {
  const p = method.formats[format];
  if (p === undefined || !p.credit_eligible) {
    return false;
  }
  return mode === 'OFFLINE' ? p.grade_class === 'D' : true;
}

function sortedUnique(list: readonly FormatIdT[]): FormatIdT[] {
  return [...new Set(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type PoolCell = { items: number; formats: Set<FormatIdT> };

/** 트랙 1개의 AssessmentInventory. 집계 기준 문항 = 저작 문항 중 deferred가 아닌 것. */
export function buildInventory(
  track: TrackIdT,
  concepts: readonly ConceptFile[],
  idx: Indexes,
  method: Method,
): Inventory {
  const pool: Record<string, Record<AiModeT, PoolCell>> = {};
  for (const k of LEVEL_KEYS) {
    pool[k] = {
      FULL: { items: 0, formats: new Set() },
      JUDGE_ONLY: { items: 0, formats: new Set() },
      LLM_ONLY: { items: 0, formats: new Set() },
      OFFLINE: { items: 0, formats: new Set() },
    };
  }
  const list: Inventory['concepts'] = [];
  const sorted = [...concepts].sort((a, b) => (a.data.id < b.data.id ? -1 : a.data.id > b.data.id ? 1 : 0));
  for (const c of sorted) {
    const items = Object.values(idx.itemsByConcept.get(c.data.id)?.data.items ?? {}).filter((i) => !isDeferredItem(i));
    const byMode: Record<AiModeT, FormatIdT[]> = { FULL: [], JUDGE_ONLY: [], LLM_ONLY: [], OFFLINE: [] };
    for (const mode of MODES) {
      for (const item of items) {
        if (eligible(method, item.format, mode)) {
          byMode[mode].push(item.format);
        }
      }
    }
    const required = c.data.required_for_level !== null;
    if (required) {
      for (const mode of MODES) {
        const cell = pool[String(c.data.level)]?.[mode];
        if (cell !== undefined) {
          cell.items += byMode[mode].length;
          for (const f of byMode[mode]) {
            cell.formats.add(f);
          }
        }
      }
    }
    list.push({
      concept_id: c.data.id,
      level: c.data.level,
      tier: c.data.tier,
      required_for_level: c.data.required_for_level,
      d4_possible: items.some((i) => i.format === 'digging_d4_mcq'),
      formats_by_mode: {
        FULL: sortedUnique(byMode.FULL),
        JUDGE_ONLY: sortedUnique(byMode.JUDGE_ONLY),
        LLM_ONLY: sortedUnique(byMode.LLM_ONLY),
        OFFLINE: sortedUnique(byMode.OFFLINE),
      },
    });
  }
  const cell = (k: (typeof LEVEL_KEYS)[number], mode: AiModeT) => {
    const c = pool[k]?.[mode];
    return { items: c?.items ?? 0, formats: sortedUnique([...(c?.formats ?? [])]) };
  };
  const assessmentPool: Inventory['assessment_pool'] = {
    '1': {
      FULL: cell('1', 'FULL'),
      JUDGE_ONLY: cell('1', 'JUDGE_ONLY'),
      LLM_ONLY: cell('1', 'LLM_ONLY'),
      OFFLINE: cell('1', 'OFFLINE'),
    },
    '2': {
      FULL: cell('2', 'FULL'),
      JUDGE_ONLY: cell('2', 'JUDGE_ONLY'),
      LLM_ONLY: cell('2', 'LLM_ONLY'),
      OFFLINE: cell('2', 'OFFLINE'),
    },
    '3': {
      FULL: cell('3', 'FULL'),
      JUDGE_ONLY: cell('3', 'JUDGE_ONLY'),
      LLM_ONLY: cell('3', 'LLM_ONLY'),
      OFFLINE: cell('3', 'OFFLINE'),
    },
    '4': {
      FULL: cell('4', 'FULL'),
      JUDGE_ONLY: cell('4', 'JUDGE_ONLY'),
      LLM_ONLY: cell('4', 'LLM_ONLY'),
      OFFLINE: cell('4', 'OFFLINE'),
    },
    '5': {
      FULL: cell('5', 'FULL'),
      JUDGE_ONLY: cell('5', 'JUDGE_ONLY'),
      LLM_ONLY: cell('5', 'LLM_ONLY'),
      OFFLINE: cell('5', 'OFFLINE'),
    },
  };
  return { track, concepts: list, assessment_pool: assessmentPool, cases: [] };
}

export type CapResult = {
  readonly per_mode: Record<AiModeT, number>;
  readonly offline_cap_level: number;
  readonly oracle_cap_level: number;
  /** Lk(k→k+1) × 모드 → structuralFeasibility blocker 전부. */
  readonly blockers: {
    readonly L1: Record<AiModeT, Blocker[]>;
    readonly L2: Record<AiModeT, Blocker[]>;
    readonly L3: Record<AiModeT, Blocker[]>;
    readonly L4: Record<AiModeT, Blocker[]>;
  };
  /** OFFLINE L1→L4 순 평탄화(≤ 100). */
  readonly cap_blockers: Blocker[];
};

/** capOf(mode) = 1에서 시작, k = 1..4에 대해 feasible이면 cap = k+1, 아니면 중단. */
export function computeCap(mastery: Mastery, inv: Inventory): CapResult {
  const blockers: Record<'L1' | 'L2' | 'L3' | 'L4', Record<AiModeT, Blocker[]>> = {
    L1: { FULL: [], JUDGE_ONLY: [], LLM_ONLY: [], OFFLINE: [] },
    L2: { FULL: [], JUDGE_ONLY: [], LLM_ONLY: [], OFFLINE: [] },
    L3: { FULL: [], JUDGE_ONLY: [], LLM_ONLY: [], OFFLINE: [] },
    L4: { FULL: [], JUDGE_ONLY: [], LLM_ONLY: [], OFFLINE: [] },
  };
  const perMode: Record<AiModeT, number> = { FULL: 1, JUDGE_ONLY: 1, LLM_ONLY: 1, OFFLINE: 1 };
  for (const mode of MODES) {
    let stopped = false;
    for (const t of TRANSITIONS) {
      const r = structuralFeasibility(mastery, inv, { track: inv.track, from: t.from, to: t.to }, mode, 'unknown');
      const key = `L${t.from}` as 'L1' | 'L2' | 'L3' | 'L4';
      blockers[key][mode] = r.blockers;
      if (!stopped) {
        if (r.feasible) {
          perMode[mode] = t.to;
        } else {
          stopped = true;
        }
      }
    }
  }
  const flat = [...blockers.L1.OFFLINE, ...blockers.L2.OFFLINE, ...blockers.L3.OFFLINE, ...blockers.L4.OFFLINE].slice(
    0,
    100,
  );
  return {
    per_mode: perMode,
    offline_cap_level: perMode.OFFLINE,
    oracle_cap_level: perMode.FULL,
    blockers,
    cap_blockers: flat,
  };
}
