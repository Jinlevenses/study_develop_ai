// report.json(Brief T-01-03 §4.8-4) — packc 소유 로컬 zod PackReport(.strict()). 상위 키 kpi·tier_counts·cap_blockers는
// content InstalledPack.report가 그대로 읽는다(T-01-07).
import { AiMode, FormatId } from '@fathom/contracts/common/domain';
import { FeasibilityBlocker } from '@fathom/contracts/common/practice';
import { PackKpi } from '@fathom/contracts/http/content/v1/catalog';
import { z } from 'zod';
import type { CapResult } from '../lint/inventory.js';
import type { ConceptFile } from '../validate/model.js';
import type { ItemBody } from './records.js';

const Count = z.number().int().min(0);
const Validator = z
  .object({
    status: z.enum(['pass', 'fail', 'skipped']),
    errors: Count,
    warnings: Count,
    reason: z.string().optional(),
  })
  .strict();
const Tiers = z.object({ A: Count, B: Count, C: Count }).strict();
const ModeBlockers = z.record(AiMode, z.array(FeasibilityBlocker));

export const PackReport = z
  .object({
    schema_v: z.literal(1),
    pack_id: z.string(),
    version: z.string(),
    packc_version: z.string(),
    validators: z
      .object({
        V1: Validator,
        V2: Validator,
        V3: Validator,
        V4: Validator,
        V5: Validator,
        V6: Validator,
        V7: Validator,
        V8: Validator,
        V9: Validator,
        V10: Validator,
        T2X: Validator,
      })
      .strict(),
    counts: z
      .object({
        concepts_by_tier: Tiers,
        concepts_by_level: z.object({ '1': Count, '2': Count, '3': Count, '4': Count, '5': Count }).strict(),
        kus: Count,
        misconceptions: Count,
        items_by_format: z.partialRecord(FormatId, Count),
        item_models: Count,
        t2_instances: z.literal(0),
      })
      .strict(),
    tier_counts: Tiers,
    kpi: PackKpi,
    cap: z
      .object({
        offline_cap_level: z.number().int().min(1).max(5),
        oracle_cap_level: z.number().int().min(1).max(5),
        per_mode: z.record(AiMode, z.number().int().min(1).max(5)),
        blockers: z.object({ L1: ModeBlockers, L2: ModeBlockers, L3: ModeBlockers, L4: ModeBlockers }).strict(),
      })
      .strict(),
    cap_blockers: z.array(FeasibilityBlocker).max(100),
    floor: z.object({ status: z.literal('skipped') }).strict(),
    gate_status: z
      .object({ authored: Count, seed_reviewed: Count, deferred: Count, stale: z.array(z.string()) })
      .strict(),
    copy_guard: z.object({ coverage: z.literal(0), unchecked: z.array(z.string()) }).strict(),
    oracle: z.object({}).strict(),
  })
  .strict();
export type PackReport = z.infer<typeof PackReport>;

const SKIPPED: Readonly<Record<'V3' | 'V4' | 'V5' | 'V6' | 'V8' | 'V9' | 'V10' | 'T2X', string>> = {
  V3: 'copy-guard deferred (IT-02 content WP)',
  V4: 'runner sandbox deferred (WP-05-12)',
  V5: 'deterministic gates deferred (IT-02 content WP)',
  V6: 'source coverage deferred (IT-02 content WP)',
  V8: 'Jev gates need a key (skipped at build)',
  V9: 'beta_prior = 0 until WP-02-14',
  V10: 'Korean quality heuristics deferred (IT-02 content WP)',
  T2X: 'contracts/pack/t2-expand absent (CR-32)',
};

function skipped(key: keyof typeof SKIPPED): z.infer<typeof Validator> {
  return { status: 'skipped', errors: 0, warnings: 0, reason: SKIPPED[key] };
}

export type ReportInput = {
  readonly packId: string;
  readonly version: string;
  readonly packcVersion: string;
  readonly concepts: readonly ConceptFile[];
  readonly kus: number;
  readonly misconceptions: number;
  readonly itemModels: number;
  readonly items: readonly ItemBody[];
  readonly itemFormats: ReadonlyMap<string, number>;
  readonly cap: CapResult;
  readonly offlineLearnable: number;
  readonly gate: {
    readonly authored: number;
    readonly seed_reviewed: number;
    readonly deferred: number;
    readonly stale: readonly string[];
  };
  readonly v2Warnings: number;
};

export function buildReport(input: ReportInput): PackReport {
  const tiers = { A: 0, B: 0, C: 0 };
  const levels = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const c of input.concepts) {
    tiers[c.data.tier] += 1;
    levels[String(c.data.level) as keyof typeof levels] += 1;
  }
  const n = input.concepts.length;
  const ratio = (x: number): number => (n === 0 ? 0 : x / n);
  const itemsByFormat: Record<string, number> = {};
  for (const [f, count] of [...input.itemFormats.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    itemsByFormat[f] = count;
  }
  const pass = (warnings: number): z.infer<typeof Validator> => ({ status: 'pass', errors: 0, warnings });
  return PackReport.parse({
    schema_v: 1,
    pack_id: input.packId,
    version: input.version,
    packc_version: input.packcVersion,
    validators: {
      V1: pass(0),
      V2: pass(input.v2Warnings),
      V3: skipped('V3'),
      V4: skipped('V4'),
      V5: skipped('V5'),
      V6: skipped('V6'),
      V7: pass(0),
      V8: skipped('V8'),
      V9: skipped('V9'),
      V10: skipped('V10'),
      T2X: skipped('T2X'),
    },
    counts: {
      concepts_by_tier: tiers,
      concepts_by_level: levels,
      kus: input.kus,
      misconceptions: input.misconceptions,
      items_by_format: itemsByFormat,
      item_models: input.itemModels,
      t2_instances: 0,
    },
    tier_counts: tiers,
    kpi: {
      three_stage: { full: ratio(tiers.A), lite: ratio(tiers.B), skeleton: ratio(tiers.C) },
      offline_learnable: input.offlineLearnable,
    },
    cap: {
      offline_cap_level: input.cap.offline_cap_level,
      oracle_cap_level: input.cap.oracle_cap_level,
      per_mode: input.cap.per_mode,
      blockers: input.cap.blockers,
    },
    cap_blockers: input.cap.cap_blockers,
    floor: { status: 'skipped' },
    gate_status: { ...input.gate, stale: [...input.gate.stale] },
    copy_guard: { coverage: 0, unchecked: [] },
    oracle: {},
  });
}
