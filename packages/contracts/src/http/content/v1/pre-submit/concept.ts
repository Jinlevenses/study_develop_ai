import { z } from 'zod';
import { CaseId, ConceptId, PackId, SemVer, Sha256Hex } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { StudyDay } from '../../../../common/time.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 D1] 순환 import는 getter로 TDZ를 피한다(IF-01 §6 스키마 상호 참조)
import { ConceptSummary, KnowledgeUnitView, MisconceptionView, SourceRef } from '../catalog.js';
import { ItemDeliveryPreSubmit } from './item.js';

export const ConceptPageContentPreSubmit = S({
  get concept() {
    return ConceptSummary;
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  content_hash: Sha256Hex,
  version: S({ pack_id: PackId, pack_version: SemVer, overlay_rev: z.number().int().min(0) }),
  stages: S({
    // FR-CUR-005 3단 불변식(이론 → 코드 → 핵심)
    theory: S({
      body_md: z.string().max(40_000),
      placeholder: z.boolean(),
      diagrams: z
        .array(S({ kind: z.enum(['mermaid', 'svg']), src: z.string().max(20_000), alt_ko: z.string().max(300) }))
        .max(10),
    }),
    code: S({
      body_md: z.string().max(40_000),
      placeholder: z.boolean(),
      examples: z
        .array(
          S({
            kind: z.enum(['worked', 'faded', 'task', 'case']),
            lang: z.string().max(20).nullable(),
            code: z.string().max(20_000).nullable(),
            body_md: z.string().max(8000),
          }),
        )
        .max(10),
    }),
    core: S({
      body_md: z.string().max(20_000),
      when_not_to_use_md: z.string().max(4000).nullable(),
      placeholder: z.boolean(),
    }),
  }),
  get kus() {
    return z.array(KnowledgeUnitView).max(50);
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  get misconceptions() {
    return z.array(MisconceptionView).max(30);
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  prereq_ids: z.array(ConceptId).max(30),
  successor_ids: z.array(ConceptId).max(60),
  related_case_ids: z.array(CaseId).max(20),
  get sources() {
    return z.array(SourceRef).max(30);
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  lenses: z.record(z.enum(['1', '2', '3', '4', '5']), S({ questions_md: z.array(z.string().max(500)).max(5) })), // FR-CUR-006 레벨 렌즈
  embedded_items: z.array(ItemDeliveryPreSubmit).max(5), // FR-CUR-008 (정답 없음 — 응답은 IF-LR-010)
  freshness: S({ valid_as_of_min: StudyDay.nullable(), cl_x: z.boolean(), volatile_ku_count: z.number().int().min(0) }),
});
export type ConceptPageContentPreSubmit = z.infer<typeof ConceptPageContentPreSubmit>;
