import { describe, expect, it } from 'vitest';
import type { RouteDef } from '../../../src/common/route.js';
import { AcquisitionImportStagedV1 } from '../../../src/events/catalog/acquisition.js';
import { CreateImportBody, CT_ACQUISITION_ROUTES, ImportJobView } from '../../../src/http/content/v1/acquisition.js';
import {
  CT_CATALOG_ROUTES,
  CurriculumExportLine,
  CurriculumExportQuery,
  InstallPackRequest,
  PackInstallView,
  SearchQuery,
  TrackConceptsQuery,
} from '../../../src/http/content/v1/catalog.js';
import { CT_ERRORS } from '../../../src/http/content/v1/errors.js';
import { AppealView, CT_GRADING_ROUTES, GradeAttemptRequest } from '../../../src/http/content/v1/grading.js';
import { CT_ITEMBANK_ROUTES, StagingListQuery } from '../../../src/http/content/v1/itembank.js';
import { CT_OVERLAYS_ROUTES, OverlayExportLine, OverlayPatchBody } from '../../../src/http/content/v1/overlays.js';
import { GradeAttemptResponse } from '../../../src/http/content/v1/post-submit/grading.js';
import { JudgeCardPostSubmit } from '../../../src/http/content/v1/post-submit/judge-card.js';
import { ConceptPageContentPreSubmit } from '../../../src/http/content/v1/pre-submit/concept.js';
import { SelectItemsRequest, SelectItemsResponse } from '../../../src/http/content/v1/pre-submit/item.js';
import { CreateRunRequest, CT_RUNNER_ROUTES, RunResultView } from '../../../src/http/content/v1/runner.js';
import { CreateAppealBody, SelfGradeBody } from '../../../src/http/learning/v1/attempts.js';
import { ULID } from './samples.js';

// IF-01 §6 표 55행(IF-ID · 메서드 · 경로 · route id · 호출자 · 멱등) — 기대 표를 테스트에 리터럴로 둔다(Brief §4.3).
type Row = readonly [string, string, string, string, readonly string[], boolean];
const EXPECTED: readonly Row[] = [
  ['IF-CT-001', 'POST', '/internal/v1/catalog/packs:install', 'content.catalog.packs.install', ['gateway'], true],
  [
    'IF-CT-002',
    'GET',
    '/internal/v1/catalog/packs/installs/{install_id}',
    'content.catalog.packs.install_get',
    ['gateway'],
    false,
  ],
  ['IF-CT-003', 'GET', '/internal/v1/catalog/packs', 'content.catalog.packs.list', ['gateway', 'ops-api'], false],
  ['IF-CT-004', 'GET', '/internal/v1/catalog/tracks', 'content.catalog.tracks.list', ['gateway'], false],
  [
    'IF-CT-005',
    'GET',
    '/internal/v1/catalog/tracks/{track}/concepts',
    'content.catalog.tracks.concepts',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-006',
    'GET',
    '/internal/v1/catalog/concepts/{concept_id}',
    'content.catalog.concepts.get',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-007',
    'GET',
    '/internal/v1/catalog/curriculum/export',
    'content.catalog.curriculum.export',
    ['learning'],
    false,
  ],
  [
    'IF-CT-008',
    'GET',
    '/internal/v1/catalog/concepts/{concept_id}/neighbors',
    'content.catalog.concepts.neighbors',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-009',
    'GET',
    '/internal/v1/catalog/concepts/{concept_id}/sources',
    'content.catalog.concepts.sources',
    ['gateway'],
    false,
  ],
  ['IF-CT-010', 'GET', '/internal/v1/catalog/paths', 'content.catalog.paths.list', ['gateway'], false],
  ['IF-CT-011', 'GET', '/internal/v1/catalog/layout/{track}', 'content.catalog.layout.get', ['gateway'], false],
  ['IF-CT-012', 'GET', '/internal/v1/catalog/search', 'content.catalog.search', ['gateway'], false],
  ['IF-CT-013', 'GET', '/internal/v1/catalog/overlays', 'content.catalog.overlays.list', ['gateway'], false],
  ['IF-CT-014', 'POST', '/internal/v1/catalog/overlays', 'content.catalog.overlays.create', ['gateway'], true],
  [
    'IF-CT-015',
    'POST',
    '/internal/v1/catalog/overlays/{patch_id}:revert',
    'content.catalog.overlays.revert',
    ['gateway'],
    true,
  ],
  ['IF-CT-016', 'GET', '/internal/v1/catalog/conflicts', 'content.catalog.conflicts.list', ['gateway'], false],
  ['IF-CT-017', 'GET', '/internal/v1/catalog/overlays/export', 'content.catalog.overlays.export', ['ops-api'], false],
  ['IF-CT-018', 'POST', '/internal/v1/catalog/overlays/import', 'content.catalog.overlays.import', ['ops-api'], true],
  [
    'IF-CT-019',
    'POST',
    '/internal/v1/catalog/conflicts/{conflict_id}:resolve',
    'content.catalog.conflicts.resolve',
    ['gateway'],
    true,
  ],
  [
    'IF-CT-020',
    'GET',
    '/internal/v1/catalog/blueprints',
    'content.catalog.blueprints.list',
    ['gateway', 'learning'],
    false,
  ],
  [
    'IF-CT-021',
    'POST',
    '/internal/v1/catalog/blueprints:import',
    'content.catalog.blueprints.import',
    ['gateway'],
    true,
  ],
  [
    'IF-CT-022',
    'POST',
    '/internal/v1/catalog/concepts/{concept_id}/outdated-reports',
    'content.catalog.concepts.outdated',
    ['gateway'],
    true,
  ],
  ['IF-CT-023', 'POST', '/internal/v1/catalog/packs:refresh', 'content.catalog.packs.refresh', ['gateway'], true],
  ['IF-CT-024', 'GET', '/internal/v1/catalog/cases', 'content.catalog.cases.list', ['gateway'], false],
  ['IF-CT-030', 'POST', '/internal/v1/acquisition/imports', 'content.acquisition.imports.create', ['gateway'], true],
  ['IF-CT-031', 'GET', '/internal/v1/acquisition/imports', 'content.acquisition.imports.list', ['gateway'], false],
  [
    'IF-CT-032',
    'GET',
    '/internal/v1/acquisition/imports/{job_id}',
    'content.acquisition.imports.get',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-033',
    'GET',
    '/internal/v1/acquisition/imports/{job_id}/diff',
    'content.acquisition.imports.diff',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-034',
    'POST',
    '/internal/v1/acquisition/imports/{job_id}:approve',
    'content.acquisition.imports.approve',
    ['gateway'],
    true,
  ],
  [
    'IF-CT-038',
    'POST',
    '/internal/v1/acquisition/imports/{job_id}:reject',
    'content.acquisition.imports.reject',
    ['gateway'],
    true,
  ],
  [
    'IF-CT-039',
    'POST',
    '/internal/v1/acquisition/imports/{job_id}:resume',
    'content.acquisition.imports.resume',
    ['gateway'],
    true,
  ],
  ['IF-CT-035', 'POST', '/internal/v1/acquisition/inbox', 'content.acquisition.inbox.capture', ['gateway'], true],
  ['IF-CT-036', 'GET', '/internal/v1/acquisition/inbox', 'content.acquisition.inbox.list', ['gateway'], false],
  [
    'IF-CT-037',
    'POST',
    '/internal/v1/acquisition/inbox/{inbox_id}:triage',
    'content.acquisition.inbox.triage',
    ['gateway'],
    true,
  ],
  ['IF-CT-040', 'POST', '/internal/v1/grading/attempts', 'content.grading.attempts.grade', ['learning'], true],
  [
    'IF-CT-041',
    'POST',
    '/internal/v1/grading/attempts/{attempt_id}/self-grade',
    'content.grading.attempts.self_grade',
    ['learning'],
    true,
  ],
  ['IF-CT-042', 'POST', '/internal/v1/grading/turns:judge', 'content.grading.turns.judge', ['learning'], true],
  ['IF-CT-043', 'POST', '/internal/v1/grading/appeals', 'content.grading.appeals.create', ['learning'], true],
  [
    'IF-CT-044',
    'GET',
    '/internal/v1/grading/appeals/{appeal_id}',
    'content.grading.appeals.get',
    ['gateway', 'learning'],
    false,
  ],
  [
    'IF-CT-045',
    'GET',
    '/internal/v1/grading/verdicts/{verdict_id}',
    'content.grading.verdicts.get',
    ['gateway', 'learning'],
    false,
  ],
  [
    'IF-CT-046',
    'GET',
    '/internal/v1/grading/utterances/{ref}',
    'content.grading.utterances.stream',
    ['gateway'],
    false,
  ],
  [
    'IF-CT-047',
    'GET',
    '/internal/v1/grading/verdicts/{verdict_id}/feedback',
    'content.grading.feedback.stream',
    ['gateway'],
    false,
  ],
  ['IF-CT-048', 'GET', '/internal/v1/grading/pending', 'content.grading.pending.list', ['gateway'], false],
  ['IF-CT-050', 'POST', '/internal/v1/runner/runs', 'content.runner.runs.create', ['gateway'], true],
  ['IF-CT-051', 'GET', '/internal/v1/runner/platform', 'content.runner.platform', ['gateway', 'ops-api'], false],
  ['IF-CT-055', 'POST', '/internal/v1/itembank/items:select', 'content.itembank.items.select', ['learning'], false],
  [
    'IF-CT-056',
    'GET',
    '/internal/v1/itembank/items/{item_id}/hints/{step}',
    'content.itembank.items.hint',
    ['gateway'],
    false,
  ],
  ['IF-CT-057', 'POST', '/internal/v1/itembank/reports', 'content.itembank.reports.create', ['gateway'], true],
  ['IF-CT-058', 'GET', '/internal/v1/itembank/reports', 'content.itembank.reports.list', ['gateway'], false],
  [
    'IF-CT-059',
    'POST',
    '/internal/v1/itembank/reports/{report_id}:resolve',
    'content.itembank.reports.resolve',
    ['gateway'],
    true,
  ],
  ['IF-CT-060', 'GET', '/internal/v1/itembank/health', 'content.itembank.health', ['gateway'], false],
  [
    'IF-CT-061',
    'POST',
    '/internal/v1/itembank/items/{item_id}:quarantine',
    'content.itembank.items.quarantine',
    ['gateway'],
    true,
  ],
  ['IF-CT-062', 'GET', '/internal/v1/itembank/warming', 'content.itembank.warming', ['gateway', 'ops-api'], false],
  ['IF-CT-063', 'GET', '/internal/v1/itembank/staging', 'content.itembank.staging.list', ['gateway'], false],
  [
    'IF-CT-064',
    'POST',
    '/internal/v1/itembank/staging/{staging_id}:approve',
    'content.itembank.staging.approve',
    ['gateway'],
    true,
  ],
];

const FILES = {
  catalog: CT_CATALOG_ROUTES,
  overlays: CT_OVERLAYS_ROUTES,
  acquisition: CT_ACQUISITION_ROUTES,
  grading: CT_GRADING_ROUTES,
  runner: CT_RUNNER_ROUTES,
  itembank: CT_ITEMBANK_ROUTES,
};
const ALL: readonly RouteDef[] = Object.values(FILES).flat();
const byIf = new Map<string, RouteDef>(ALL.map((r) => [r.ifId, r]));
const ifIds = (arr: readonly { ifId: string }[]): string[] => arr.map((r) => r.ifId);
const get = (id: string) => {
  const r = byIf.get(id);
  if (r === undefined) {
    throw new Error(`route ${id} missing`);
  }
  return r;
};

describe('content 라우트 55개(IF-CT)', () => {
  it('UT-CON-113 CT_*_ROUTES 6개 합집합 ifId = IF §6 표 55개, 메타 필드가 Brief §4.3 규칙과 일치 [IR-015]', () => {
    expect(ALL).toHaveLength(55);
    expect(new Set(ifIds(ALL)).size).toBe(55);
    expect(ifIds(ALL).sort()).toEqual(EXPECTED.map((r) => r[0]).sort());
    expect(new Set(ALL.map((r) => r.id)).size).toBe(55);
    // 파일별 개수·표 순서
    expect(Object.values(FILES).map((f) => f.length)).toEqual([17, 7, 10, 9, 2, 10]);
    expect(ifIds(CT_ACQUISITION_ROUTES)).toEqual([
      'IF-CT-030',
      'IF-CT-031',
      'IF-CT-032',
      'IF-CT-033',
      'IF-CT-034',
      'IF-CT-038',
      'IF-CT-039',
      'IF-CT-035',
      'IF-CT-036',
      'IF-CT-037',
    ]);

    for (const [ifId, method, path, id, callers, idem] of EXPECTED) {
      const r = get(ifId);
      expect(r.method, ifId).toBe(method);
      expect(r.path, ifId).toBe(path);
      expect(r.id, ifId).toBe(id);
      expect(r.id.startsWith('content.'), ifId).toBe(true);
      expect(r.path.startsWith('/internal/v1/'), ifId).toBe(true);
      expect([...r.allowedCallers], ifId).toEqual(callers);
      expect(r.idempotent, ifId).toBe(idem);
      expect(['D', 'O']).toContain(r.freeze);
      expect(['R0', 'R1', 'R2', 'R3']).toContain(r.slice);
      for (const f of r.fr) {
        expect(f, ifId).toMatch(/^[A-Z]{1,4}(-[A-Z0-9*~]+)+$/);
      }
    }

    // deadlineMs — 표의 데드라인·슬라이스 열(Brief §4.3), 나머지는 생략(기본 2000)
    const deadlines: Record<string, number> = {
      'IF-CT-012': 1000,
      'IF-CT-035': 500,
      'IF-CT-040': 2900,
      'IF-CT-042': 3400,
      'IF-CT-046': 60000,
      'IF-CT-047': 60000,
      'IF-CT-050': 6000,
      'IF-CT-055': 1500,
    };
    for (const r of ALL) {
      expect(r.deadlineMs, r.ifId).toBe(deadlines[r.ifId]);
    }
    // bodyLimitBytes — 가져오기·Inbox 4 MiB, NDJSON 요청 8 GiB
    const limits: Record<string, number> = {
      'IF-CT-030': 4_194_304,
      'IF-CT-035': 4_194_304,
      'IF-CT-018': 8_589_934_592,
    };
    for (const r of ALL) {
      expect(r.bodyLimitBytes, r.ifId).toBe(limits[r.ifId]);
    }
    // responseKind·bodyKind
    const kinds: Record<string, string> = {
      'IF-CT-007': 'ndjson',
      'IF-CT-017': 'ndjson',
      'IF-CT-046': 'sse',
      'IF-CT-047': 'sse',
    };
    for (const r of ALL) {
      expect(r.responseKind, r.ifId).toBe(kinds[r.ifId]);
      expect(r.request.bodyKind, r.ifId).toBe(r.ifId === 'IF-CT-018' ? 'ndjson' : undefined);
    }
    // paginated — 응답이 Page·StagingDiffPage이거나 요청이 PageQuery
    const paged = [
      'IF-CT-005',
      'IF-CT-013',
      'IF-CT-016',
      'IF-CT-031',
      'IF-CT-033',
      'IF-CT-036',
      'IF-CT-048',
      'IF-CT-058',
      'IF-CT-060',
      'IF-CT-063',
    ];
    expect(
      ALL.filter((r) => r.paginated)
        .map((r) => r.ifId)
        .sort(),
    ).toEqual(paged);
    // freeze·slice 샘플(슬라이스·동결 열의 첫 R\d·D/O)
    const fs = (id: string) => `${get(id).freeze}${get(id).slice}`;
    expect([
      fs('IF-CT-001'),
      fs('IF-CT-008'),
      fs('IF-CT-014'),
      fs('IF-CT-020'),
      fs('IF-CT-046'),
      fs('IF-CT-055'),
    ]).toEqual(['DR0', 'DR1', 'OR2', 'OR3', 'OR2', 'DR0']);
    // fr 펼치기(`·` 접두 규칙, `~` 범위는 문자열 그대로)
    expect([...get('IF-CT-001').fr]).toEqual(['FR-CUR-002', 'FR-CUR-004', 'FR-SET-014', 'CR-12']);
    expect([...get('IF-CT-006').fr]).toEqual(['FR-CUR-004~008', 'FR-CUR-012', 'FR-CUR-021']);
    expect([...get('IF-CT-007').fr]).toEqual(['FR-CUR-025', 'FR-PRG-013', 'D-4', 'D-9']);
    // 204 응답 라우트는 content에 없다
    expect(ALL.some((r) => 204 in r.response)).toBe(false);

    // --- params 스칼라 매핑: ULID·ConceptId·ItemId·TrackId·step·track|all
    const p = (id: string) => get(id).request.params;
    expect(p('IF-CT-002')?.safeParse({ install_id: ULID }).success).toBe(true);
    expect(p('IF-CT-002')?.safeParse({ install_id: 'x' }).success).toBe(false);
    expect(p('IF-CT-006')?.safeParse({ concept_id: 'k8s.probes' }).success).toBe(true);
    expect(p('IF-CT-006')?.safeParse({ concept_id: ULID }).success).toBe(false);
    expect(p('IF-CT-005')?.safeParse({ track: 'k8s' }).success).toBe(true);
    expect(p('IF-CT-011')?.safeParse({ track: 'all' }).success).toBe(true);
    expect(p('IF-CT-011')?.safeParse({ track: 'nope' }).success).toBe(false);
    expect(p('IF-CT-056')?.safeParse({ item_id: 'k8s.probes.i01', step: '2' }).success).toBe(true);
    expect(p('IF-CT-056')?.safeParse({ item_id: 'k8s.probes.i01', step: '5' }).success).toBe(false);
    expect(p('IF-CT-056')?.safeParse({ item_id: 'k8s.probes.i01', step: '0' }).success).toBe(false);
    expect(p('IF-CT-001')).toBeUndefined();
    expect(p('IF-CT-046')?.safeParse({ ref: ULID }).success).toBe(true);
  });

  it('UT-CON-114 라우트 스키마 동일성(getter 경유 포함): 요청·응답이 정본 스키마와 같은 인스턴스다 [IF-CT-006][IF-CT-040]', () => {
    expect(get('IF-CT-001').request.body).toBe(InstallPackRequest);
    expect(get('IF-CT-001').response[202]).toBe(PackInstallView);
    expect(get('IF-CT-005').request.query).toBe(TrackConceptsQuery);
    expect(get('IF-CT-007').request.query).toBe(CurriculumExportQuery);
    expect(get('IF-CT-007').response[200]).toBe(CurriculumExportLine);
    expect(get('IF-CT-012').request.query).toBe(SearchQuery);
    expect(get('IF-CT-006').response[200]).toBe(ConceptPageContentPreSubmit); // getter(D1 C3)
    expect(get('IF-CT-014').request.body).toBe(OverlayPatchBody);
    expect(get('IF-CT-017').response[200]).toBe(OverlayExportLine);
    expect(get('IF-CT-018').request.body).toBe(OverlayExportLine);
    expect(get('IF-CT-030').request.body).toBe(CreateImportBody);
    expect(get('IF-CT-032').response[200]).toBe(ImportJobView);
    expect(get('IF-CT-040').request.body).toBe(GradeAttemptRequest);
    expect(get('IF-CT-040').response[200]).toBe(GradeAttemptResponse);
    expect(get('IF-CT-041').request.body).toBe(SelfGradeBody); // getter(D1 C5)
    expect(get('IF-CT-041').response[200]).toBe(GradeAttemptResponse);
    expect(get('IF-CT-043').request.body).toBe(CreateAppealBody); // getter(D1 C5)
    expect(get('IF-CT-043').response[201]).toBe(AppealView);
    expect(get('IF-CT-045').response[200]).toBe(JudgeCardPostSubmit); // getter(D1 C4)
    expect(get('IF-CT-050').request.body).toBe(CreateRunRequest);
    expect(get('IF-CT-050').response[200]).toBe(RunResultView);
    expect(get('IF-CT-055').request.body).toBe(SelectItemsRequest);
    expect(Object.is(get('IF-CT-055').response[200], SelectItemsResponse)).toBe(true);
    expect(get('IF-CT-063').request.query).toBe(StagingListQuery);
    // Page(...) 래퍼는 호출마다 새 스키마라 동일성 대신 모양을 본다
    expect(get('IF-CT-048').response[200]?.safeParse({ items: [], next_cursor: null }).success).toBe(true);
    expect(get('IF-CT-048').response[200]?.safeParse({ items: [] }).success).toBe(false);
  });

  it('UT-CON-115 CT_ERRORS 26키 = IF §2.6.3 CT 행, 키 정규식 STD-NAM-90, status·retryable 규칙(§4.5) [IR-015][STD-ERR-01]', () => {
    const keys = Object.keys(CT_ERRORS);
    expect(keys).toEqual([
      'CT-LIMIT-001',
      'CT-LIMIT-002',
      'CT-POLICY-001',
      'CT-POLICY-002',
      'CT-POLICY-003',
      'CT-POLICY-004',
      'CT-NOTFOUND-001',
      'CT-NOTFOUND-002',
      'CT-NOTFOUND-003',
      'CT-NOTFOUND-004',
      'CT-NOTFOUND-005',
      'CT-NOTFOUND-006',
      'CT-NOTFOUND-007',
      'CT-NOTFOUND-008',
      'CT-NOTFOUND-009',
      'CT-NOTFOUND-010',
      'CT-NOTFOUND-011',
      'CT-CONFLICT-010',
      'CT-CONFLICT-011',
      'CT-CONFLICT-012',
      'CT-CONFLICT-013',
      'CT-CONFLICT-014',
      'CT-CONFLICT-015',
      'CT-VAL-010',
      'CT-VAL-011',
      'CT-DEP-002',
    ]);
    expect(keys).toHaveLength(26);
    for (const [code, e] of Object.entries(CT_ERRORS)) {
      expect(code).toMatch(/^CT-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/);
      expect(Number(code.slice(-3))).toBeLessThan(900); // 서비스 고유 = 001~899
      expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
      expect(e.title.length, code).toBeGreaterThan(0);
      expect(e.title, code).not.toMatch(/[`()]/);
    }
    expect(CT_ERRORS['CT-LIMIT-001']).toEqual({ status: 429, title: '러너 대기 큐 > 20', retryable: true });
    expect(CT_ERRORS['CT-LIMIT-002'].status).toBe(413);
    expect(CT_ERRORS['CT-POLICY-001'].status).toBe(403);
    expect(CT_ERRORS['CT-CONFLICT-014'].status).toBe(409);
    expect(CT_ERRORS['CT-VAL-011'].status).toBe(422);
    expect(CT_ERRORS['CT-DEP-002']).toMatchObject({ status: 503, retryable: true });
    // 같은 이벤트 샘플 스키마 참조가 깨지지 않았는지(이름 충돌 가드)
    expect(AcquisitionImportStagedV1.safeParse({}).success).toBe(false);
  });
});
