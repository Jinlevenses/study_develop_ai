// DCP-01 §6.4 — packs/<track>/misconceptions/<concept_id>.yaml.
import { ConceptId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { SourceRef } from './common.js';

export const McKind = z.enum([
  'sibling_confusion',
  'overgeneralization',
  'causal_reversal',
  'version_drift',
  'boundary',
  'mechanism_confusion',
  'quantifier',
  'analogy_overreach',
  'security_false_sense',
]); // R2 §2.4

export const MetaFamily = z.enum([
  'mf_phase_confusion',
  'mf_state_vs_event',
  'mf_mean_vs_tail',
  'mf_sync_async_boundary',
  'mf_copy_vs_share',
  'mf_scope_overreach',
  'mf_causal_reversal',
  'mf_version_drift',
  'mf_layer_responsibility',
  'mf_guarantee_overtrust',
  'mf_cost_blindness',
  'mf_boundary_case',
]); // 닫힌 12종(DN-12)

export const McFile = z
  .object({
    schema_v: z.literal(1),
    concept_id: ConceptId,
    mcs: z.record(
      z.string().regex(/^m\d{2}$/),
      z
        .object({
          kind: McKind,
          meta_family: MetaFamily,
          wrong_belief: z.string().min(10).max(200),
          correction: z.string().min(10).max(240),
          refutes: z.array(z.string().regex(/^k\d{2}$/)).min(1),
          prevalence: z.enum(['high', 'mid', 'low']),
          source_refs: z.array(SourceRef).default([]),
        })
        .strict(),
    ),
  })
  .strict();
export type McFile = z.infer<typeof McFile>;
