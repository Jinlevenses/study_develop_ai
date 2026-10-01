import { describe, expect, it, vi } from 'vitest';
import { conceptRef, itemDelivery, SHA, ULID } from './samples.js';

// UT-CON-112 — Brief D1: 순환 import 5쌍은 getter로 TDZ를 피한다. 어느 쪽이 먼저 로드돼도 ReferenceError가 없어야 한다.
// 쌍마다 vi.resetModules() 후 A→B, 다시 reset 후 B→A 순서로 리터럴 경로 동적 import한다(STD-TS-12). 같은 세대의 모듈끼리만 비교한다.

const appealView = {
  appeal_id: ULID,
  verdict_id: ULID,
  reason: 'key_wrong',
  state: 'received',
  classification: null,
  new_verdict_id: null,
  rejection_reason_ko: null,
  created_at: 1,
  decided_at: null,
};
const activated = {
  pack_id: 'k8s',
  track: 'k8s',
  version: '1.0.0',
  channel: 'seed',
  manifest_hash: SHA,
  merkle_root: SHA,
  previous_version: null,
  changed_concept_ids: [],
  changed_ku_ids: [],
  offline_cap_level: 3,
  catalog_version: 1,
  activated_at: 1,
};
const selectResponse = {
  selected_at: 1,
  ai_mode: 'OFFLINE',
  runner_enabled: false,
  slots: [
    {
      slot_id: ULID,
      status: 'ok',
      format_used: 'ox',
      items: [itemDelivery],
      case_runtime: null,
      artifact_runtime: {
        artifact_id: 'sre.art.postmortem-cascading-latency',
        template_kind: 'postmortem',
        template_md: '# 템플릿',
        item: itemDelivery,
      },
      shortfall: null,
    },
  ],
};
const continuation = { next_node: itemDelivery, finished: false, revealed_evidence_keys: [] };
const createAppeal = { appeal_id: ULID, verdict_id: ULID, reason: 'ambiguous', text: null };

describe('순환 import 5쌍(D1) 양방향 로드', () => {
  it('UT-CON-112 순환 5쌍(C1~C5) 양방향 로드 throw 0 + 대표 스키마 parse 성공 [FR-CUR-002][IF-CT-006][IF-CT-041][IF-CT-045]', async () => {
    {
      vi.resetModules();
      const http1 = await import('../../../src/http/content/v1/catalog.js');
      const ev1 = await import('../../../src/events/catalog/catalog.js');
      vi.resetModules();
      const ev2 = await import('../../../src/events/catalog/catalog.js');
      const http2 = await import('../../../src/http/content/v1/catalog.js');
      for (const ev of [ev1, ev2]) {
        expect(ev.CatalogPackActivatedV1.safeParse(activated).success).toBe(true);
        expect(ev.CatalogPackActivatedV1.safeParse({ ...activated, channel: 'x' }).success).toBe(false);
      }
      for (const http of [http1, http2]) {
        expect(http.CurriculumExportLine.safeParse({ kind: 'concept', concept: conceptRef }).success).toBe(true);
        expect(
          http.CurriculumExportLine.safeParse({ kind: 'concept', concept: { ...conceptRef, level: 9 } }).success,
        ).toBe(false);
      }
    }
    // 쌍 구분
    {
      vi.resetModules();
      const item1 = await import('../../../src/http/content/v1/pre-submit/item.js');
      const case1 = await import('../../../src/http/content/v1/pre-submit/case.js');
      vi.resetModules();
      const case2 = await import('../../../src/http/content/v1/pre-submit/case.js');
      const item2 = await import('../../../src/http/content/v1/pre-submit/item.js');
      for (const c of [case1, case2]) {
        expect(c.CaseContinuationPreSubmit.safeParse(continuation).success).toBe(true);
        expect(
          c.CaseContinuationPreSubmit.safeParse({ ...continuation, next_node: { ...itemDelivery, level: 9 } }).success,
        ).toBe(false);
      }
      for (const i of [item1, item2]) {
        expect(i.SelectItemsResponse.safeParse(selectResponse).success).toBe(true);
      }
    }
    // 쌍 구분
    {
      vi.resetModules();
      const cat1 = await import('../../../src/http/content/v1/catalog.js');
      const con1 = await import('../../../src/http/content/v1/pre-submit/concept.js');
      expect(cat1.CatalogConceptsGetRoute.response[200]).toBe(con1.ConceptPageContentPreSubmit);
      vi.resetModules();
      const con2 = await import('../../../src/http/content/v1/pre-submit/concept.js');
      const cat2 = await import('../../../src/http/content/v1/catalog.js');
      expect(cat2.CatalogConceptsGetRoute.response[200]).toBe(con2.ConceptPageContentPreSubmit);
      for (const con of [con1, con2]) {
        expect(con.ConceptPageContentPreSubmit.shape.kus.safeParse([]).success).toBe(true);
        expect(con.ConceptPageContentPreSubmit.shape.kus.safeParse([{}]).success).toBe(false);
        expect(con.ConceptPageContentPreSubmit.shape.misconceptions.safeParse([]).success).toBe(true);
        expect(con.ConceptPageContentPreSubmit.shape.sources.safeParse([]).success).toBe(true);
        expect(con.ConceptPageContentPreSubmit.shape.concept.safeParse({ ...conceptRef }).success).toBe(false); // ConceptSummary ≠ ConceptRef
      }
    }
    // 쌍 구분
    {
      vi.resetModules();
      const g1 = await import('../../../src/http/content/v1/grading.js');
      const j1 = await import('../../../src/http/content/v1/post-submit/judge-card.js');
      expect(g1.GradingVerdictsGetRoute.response[200]).toBe(j1.JudgeCardPostSubmit);
      vi.resetModules();
      const j2 = await import('../../../src/http/content/v1/post-submit/judge-card.js');
      const g2 = await import('../../../src/http/content/v1/grading.js');
      expect(g2.GradingVerdictsGetRoute.response[200]).toBe(j2.JudgeCardPostSubmit);
      for (const [g, j] of [
        [g1, j1],
        [g2, j2],
      ] as const) {
        expect(g.AppealView.safeParse(appealView).success).toBe(true);
        expect(j.JudgeCardPostSubmit.shape.appeal.safeParse(appealView).success).toBe(true);
        expect(j.JudgeCardPostSubmit.shape.appeal.safeParse(null).success).toBe(true);
        expect(j.JudgeCardPostSubmit.shape.appeal.safeParse({ ...appealView, reason: 'nope' }).success).toBe(false);
      }
    }
    // 쌍 구분
    {
      vi.resetModules();
      const g1 = await import('../../../src/http/content/v1/grading.js');
      const a1 = await import('../../../src/http/learning/v1/attempts.js');
      expect(g1.GradingAttemptsSelfGradeRoute.request.body).toBe(a1.SelfGradeBody);
      expect(g1.GradingAppealsCreateRoute.request.body).toBe(a1.CreateAppealBody);
      vi.resetModules();
      const a2 = await import('../../../src/http/learning/v1/attempts.js');
      const g2 = await import('../../../src/http/content/v1/grading.js');
      expect(g2.GradingAttemptsSelfGradeRoute.request.body).toBe(a2.SelfGradeBody);
      expect(g2.GradingAppealsCreateRoute.request.body).toBe(a2.CreateAppealBody);
      for (const a of [a1, a2]) {
        expect(a.CreateAppealBody.safeParse(createAppeal).success).toBe(true);
        expect(a.CreateAppealBody.safeParse({ ...createAppeal, reason: 'nope' }).success).toBe(false);
        expect(a.AppealBody.safeParse({ appeal_id: ULID, reason: 'other', text: null }).success).toBe(true);
      }
    }
  });
});
