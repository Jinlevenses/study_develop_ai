import { describe, expect, it } from 'vitest';
import {
  CaseCatalogQuery,
  CurriculumExportLine,
  InstalledPack,
  InstallPackRequest,
  LayoutView,
  NeighborsQuery,
  PackChannel,
  PackInstallView,
  PackSource,
  SearchQuery,
  TrackCap,
  TrackConceptsQuery,
} from '../../../src/http/content/v1/catalog.js';
import { ConceptPageContentPreSubmit } from '../../../src/http/content/v1/pre-submit/concept.js';
import { inventory } from '../pack/inventory.js';
import { conceptRef, conceptSummary, itemDelivery, SHA, ULID } from './samples.js';

const installView = {
  install_id: ULID,
  state: 'activated',
  packs: [{ pack_id: 'k8s', track: 'k8s', version: '1.0.0', previous_version: null, conflicts: 0 }],
  problem: null,
  started_at: 1,
  finished_at: 2,
};

describe('content catalog.ts 스키마', () => {
  it('UT-CON-100 PackSource 3종·미지 kind 거부, InstallPackRequest, PackInstallView.state 8종, TrackConceptsQuery coerce, SearchQuery.kinds 정규식 [FR-CUR-002][FR-CUR-011]', () => {
    expect(PackSource.safeParse({ kind: 'bundled', track: null }).success).toBe(true);
    expect(PackSource.safeParse({ kind: 'bundled', track: 'k8s' }).success).toBe(true);
    expect(PackSource.safeParse({ kind: 'file', path: '/tmp/k8s.fpack' }).success).toBe(true);
    expect(PackSource.safeParse({ kind: 'user_dir', dir: '/home/me/pack' }).success).toBe(true);
    expect(PackSource.safeParse({ kind: 'url', url: 'https://example.com' }).success).toBe(false);
    expect(PackSource.safeParse({ kind: 'file', path: '' }).success).toBe(false);
    expect(PackSource.safeParse({ kind: 'file', path: '/a', extra: 1 }).success).toBe(false);
    expect(PackChannel.options).toEqual(['seed', 'local', 'user']);

    const req = { install_id: ULID, source: { kind: 'bundled', track: null }, channel: 'seed', allow_downgrade: false };
    expect(InstallPackRequest.safeParse(req).success).toBe(true);
    expect(InstallPackRequest.safeParse({ ...req, channel: 'x' }).success).toBe(false);
    expect(InstallPackRequest.safeParse({ ...req, extra: 1 }).success).toBe(false);

    expect(PackInstallView.safeParse(installView).success).toBe(true);
    expect(PackInstallView.shape.state.options).toHaveLength(8);
    expect(PackInstallView.safeParse({ ...installView, state: 'done' }).success).toBe(false);
    expect(PackInstallView.safeParse({ ...installView, packs: Array(26).fill(installView.packs[0]) }).success).toBe(
      false,
    );

    const q = TrackConceptsQuery.parse({ level: '3' });
    expect(q.level).toBe(3);
    expect(q.limit).toBe(200);
    expect(TrackConceptsQuery.safeParse({ level: '6' }).success).toBe(false);
    expect(TrackConceptsQuery.safeParse({ limit: '201' }).success).toBe(false);

    expect(SearchQuery.safeParse({ q: '프로브', kinds: 'concept,ku' }).success).toBe(true);
    expect(SearchQuery.safeParse({ q: '프로브', kinds: 'foo' }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: '프로브', kinds: 'concept,' }).success).toBe(false);
    expect(SearchQuery.parse({ q: 'a' }).limit).toBe(10);
    expect(SearchQuery.safeParse({ q: '' }).success).toBe(false);

    // [Brief §4.4] 이름 있는 쿼리 스키마
    expect(NeighborsQuery.parse({}).depth).toBe(1);
    expect(NeighborsQuery.safeParse({ depth: '3' }).success).toBe(false);
    expect(CaseCatalogQuery.safeParse({ track: 'k8s', level: '4' }).success).toBe(true);
    expect(CaseCatalogQuery.safeParse({ level: '6' }).success).toBe(false);

    // --- (이어서)
    expect(TrackCap.safeParse({ declared: 5, offline: 3, oracle: 4, display: 4 }).success).toBe(true);
    expect(TrackCap.safeParse({ declared: 6, offline: 3, oracle: 4, display: 4 }).success).toBe(false);
    const pack = {
      pack_id: 'k8s',
      track: 'k8s',
      version: '1.0.0',
      channel: 'seed',
      manifest_hash: SHA,
      merkle_root: SHA,
      activated_at: 1,
      counts: { concepts: 1, kus: 1, misconceptions: 1, items: 1, cases: 0 },
      report: {
        kpi: { three_stage: { full: 0.5, lite: 0.3, skeleton: 0.2 }, offline_learnable: 3 },
        tier_counts: { A: 1, B: 0, C: 0 },
        cap_blockers: [{ code: 'NO_ASSESSMENT_POOL', detail_ko: '풀 부족' }],
      },
    };
    expect(InstalledPack.safeParse(pack).success).toBe(true);
    expect(
      InstalledPack.safeParse({ ...pack, report: { ...pack.report, cap_blockers: [{ code: 'X', detail_ko: '' }] } })
        .success,
    ).toBe(false);
    const layout = {
      track: 'all',
      version: SHA,
      width: 10,
      height: 10,
      nodes: { 'k8s.probes': { x: 1, y: 2 } },
      edges: [],
    };
    expect(LayoutView.safeParse(layout).success).toBe(true);
    expect(LayoutView.safeParse({ ...layout, track: 'nope' }).success).toBe(false);
  });

  it('UT-CON-101 CurriculumExportLine 6종(header·concept·case·inventory·path·end) 각 1건 통과 [FR-CUR-025][FR-PRG-013]', () => {
    const lines = [
      {
        kind: 'header',
        v: 1,
        version: 3,
        full: true,
        pack_set_hash: SHA,
        packs: [{ pack_id: 'k8s', track: 'k8s', version: '1.0.0', manifest_hash: SHA }],
        generated_at: 1,
      },
      { kind: 'concept', concept: conceptRef },
      { kind: 'case', case: { case_id: 'k8s.case.liveness-restart-storm', tracks: ['k8s'], level: 4, floor: false } },
      { kind: 'inventory', track: 'k8s', inventory: inventory() },
      {
        kind: 'path',
        path: { path_id: 'path.backend-core', title_ko: '백엔드', tracks: ['be'], concept_ids: ['k8s.probes'] },
      },
      { kind: 'end', count: 5, sha256: SHA },
    ];
    for (const line of lines) {
      expect(CurriculumExportLine.safeParse(line).success, String(line.kind)).toBe(true);
    }
    expect(lines).toHaveLength(6);
    expect(CurriculumExportLine.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(CurriculumExportLine.safeParse({ ...lines[0], extra: 1 }).success).toBe(false);
    expect(
      CurriculumExportLine.safeParse({ ...lines[2], case: { ...(lines[2] as { case: object }).case, tracks: [] } })
        .success,
    ).toBe(false);
  });

  it('UT-CON-102 ConceptPageContentPreSubmit: lenses 5키 통과·4키 거부(전수 record) [FR-CUR-005][FR-CUR-006]', () => {
    const stage = { body_md: '본문', placeholder: false };
    const page = {
      concept: conceptSummary,
      content_hash: SHA,
      version: { pack_id: 'k8s', pack_version: '1.0.0', overlay_rev: 0 },
      stages: {
        theory: { ...stage, diagrams: [] },
        code: { ...stage, examples: [] },
        core: { ...stage, when_not_to_use_md: null },
      },
      kus: [],
      misconceptions: [],
      prereq_ids: [],
      successor_ids: [],
      related_case_ids: [],
      sources: [],
      lenses: {
        1: { questions_md: [] },
        2: { questions_md: [] },
        3: { questions_md: [] },
        4: { questions_md: [] },
        5: { questions_md: ['왜?'] },
      },
      embedded_items: [itemDelivery],
      freshness: { valid_as_of_min: null, cl_x: false, volatile_ku_count: 0 },
    };
    expect(ConceptPageContentPreSubmit.safeParse(page).success).toBe(true);
    const { 5: _drop, ...four } = page.lenses;
    expect(ConceptPageContentPreSubmit.safeParse({ ...page, lenses: four }).success).toBe(false);
    expect(
      ConceptPageContentPreSubmit.safeParse({ ...page, lenses: { ...page.lenses, 6: { questions_md: [] } } }).success,
    ).toBe(false);
    expect(
      ConceptPageContentPreSubmit.safeParse({ ...page, embedded_items: Array(6).fill(itemDelivery) }).success,
    ).toBe(false);
    expect(ConceptPageContentPreSubmit.safeParse({ ...page, extra: 1 }).success).toBe(false);
  });
});
