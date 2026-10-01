import { describe, expect, it } from 'vitest';
import { GenerateRequest, GenerateResult } from '../../../src/ai/generate.js';
import { JudgeRequest, JudgeResult } from '../../../src/ai/judge.js';
import { CreateWorkOrderBody } from '../../../src/ai/work-order.js';
import type { RouteDef } from '../../../src/common/route.js';
import { AI_CALIBRATION_ROUTES, GoldExportLine } from '../../../src/http/ai-gateway/v1/calibration.js';
import { AI_ERRORS } from '../../../src/http/ai-gateway/v1/errors.js';
import { AI_FIREWALL_ROUTES } from '../../../src/http/ai-gateway/v1/firewall.js';
import { AI_GENERATE_ROUTES } from '../../../src/http/ai-gateway/v1/generate.js';
import { AI_JOBS_ROUTES, CreateJobBody } from '../../../src/http/ai-gateway/v1/jobs.js';
import { AI_JUDGE_ROUTES } from '../../../src/http/ai-gateway/v1/judge.js';
import { AI_MODE_ROUTES } from '../../../src/http/ai-gateway/v1/mode.js';
import { AI_PROVIDERS_ROUTES } from '../../../src/http/ai-gateway/v1/providers.js';
import { AI_SECRETS_ROUTES } from '../../../src/http/ai-gateway/v1/secrets.js';
import { AI_STREAMS_ROUTES } from '../../../src/http/ai-gateway/v1/streams.js';
import { AI_USAGE_ROUTES } from '../../../src/http/ai-gateway/v1/usage.js';
import { AI_WORK_ORDERS_ROUTES, WorkOrderListQuery } from '../../../src/http/ai-gateway/v1/work-orders.js';

// IF-01 §7 표 39행(IF-ID · 메서드 · 경로 · route id · 호출자 · 멱등) — 기대 표를 테스트에 리터럴로 둔다(Brief §4.3).
type Row = readonly [string, string, string, string, readonly string[], boolean];
const EXPECTED: readonly Row[] = [
  ['IF-AI-001', 'POST', '/internal/v1/judge/{task_id}', 'ai-gateway.judge.run', ['content'], true],
  ['IF-AI-002', 'POST', '/internal/v1/generate/{task_id}', 'ai-gateway.generate.run', ['content'], true],
  ['IF-AI-003', 'GET', '/internal/v1/streams/{ref}', 'ai-gateway.streams.get', ['content'], false],
  ['IF-AI-010', 'POST', '/internal/v1/jobs', 'ai-gateway.jobs.create', ['content'], true],
  ['IF-AI-011', 'GET', '/internal/v1/jobs', 'ai-gateway.jobs.list', ['gateway', 'content'], false],
  ['IF-AI-012', 'GET', '/internal/v1/jobs/{job_id}', 'ai-gateway.jobs.get', ['gateway', 'content'], false],
  ['IF-AI-013', 'POST', '/internal/v1/jobs/{job_id}:cancel', 'ai-gateway.jobs.cancel', ['gateway', 'content'], true],
  ['IF-AI-014', 'GET', '/internal/v1/jobs/{job_id}/result', 'ai-gateway.jobs.result', ['content'], false],
  ['IF-AI-020', 'POST', '/internal/v1/work-orders', 'ai-gateway.work_orders.create', ['content'], true],
  ['IF-AI-021', 'GET', '/internal/v1/work-orders', 'ai-gateway.work_orders.list', ['gateway', 'content'], false],
  [
    'IF-AI-022',
    'POST',
    '/internal/v1/work-orders/{work_order_id}:decide',
    'ai-gateway.work_orders.decide',
    ['gateway'],
    true,
  ],
  [
    'IF-AI-023',
    'GET',
    '/internal/v1/work-orders/{work_order_id}',
    'ai-gateway.work_orders.get',
    ['gateway', 'content'],
    false,
  ],
  ['IF-AI-025', 'GET', '/internal/v1/providers', 'ai-gateway.providers.list', ['gateway', 'ops-api'], false],
  ['IF-AI-026', 'POST', '/internal/v1/providers:probe', 'ai-gateway.providers.probe', ['gateway', 'ops-api'], true],
  [
    'IF-AI-027',
    'PUT',
    '/internal/v1/providers/{provider_id}/consent',
    'ai-gateway.providers.consent',
    ['gateway'],
    true,
  ],
  ['IF-AI-028', 'PUT', '/internal/v1/providers/{provider_id}/config', 'ai-gateway.providers.config', ['gateway'], true],
  [
    'IF-AI-029',
    'POST',
    '/internal/v1/providers/generic-cli',
    'ai-gateway.providers.generic_cli_add',
    ['gateway'],
    true,
  ],
  [
    'IF-AI-034',
    'DELETE',
    '/internal/v1/providers/generic-cli/{provider_id}',
    'ai-gateway.providers.generic_cli_remove',
    ['gateway'],
    true,
  ],
  ['IF-AI-030', 'PUT', '/internal/v1/secrets/{provider_id}', 'ai-gateway.secrets.put', ['gateway'], true],
  ['IF-AI-031', 'GET', '/internal/v1/secrets', 'ai-gateway.secrets.list', ['gateway'], false],
  ['IF-AI-032', 'DELETE', '/internal/v1/secrets/{provider_id}', 'ai-gateway.secrets.delete', ['gateway'], true],
  ['IF-AI-033', 'POST', '/internal/v1/secrets:unlock', 'ai-gateway.secrets.unlock', ['gateway'], true],
  ['IF-AI-035', 'GET', '/internal/v1/usage', 'ai-gateway.usage.summary', ['gateway', 'ops-api'], false],
  ['IF-AI-036', 'GET', '/internal/v1/usage/calls', 'ai-gateway.usage.calls', ['gateway'], false],
  ['IF-AI-037', 'GET', '/internal/v1/usage/budget', 'ai-gateway.usage.budget', ['gateway'], false],
  ['IF-AI-038', 'PUT', '/internal/v1/usage/budget', 'ai-gateway.usage.budget_put', ['gateway'], true],
  ['IF-AI-039', 'GET', '/internal/v1/mode', 'ai-gateway.mode.get', ['gateway', 'content', 'ops-api'], false],
  ['IF-AI-040', 'GET', '/internal/v1/mode/preferences', 'ai-gateway.mode.preferences', ['gateway'], false],
  ['IF-AI-041', 'PUT', '/internal/v1/mode/preferences', 'ai-gateway.mode.preferences_put', ['gateway'], true],
  ['IF-AI-042', 'GET', '/internal/v1/calibration', 'ai-gateway.calibration.status', ['gateway'], false],
  [
    'IF-AI-043',
    'GET',
    '/internal/v1/calibration/confirm-cards',
    'ai-gateway.calibration.confirm_cards',
    ['gateway'],
    false,
  ],
  [
    'IF-AI-044',
    'GET',
    '/internal/v1/calibration/gold/export',
    'ai-gateway.calibration.gold_export',
    ['ops-api'],
    false,
  ],
  [
    'IF-AI-045',
    'POST',
    '/internal/v1/calibration/gold/import',
    'ai-gateway.calibration.gold_import',
    ['ops-api'],
    true,
  ],
  [
    'IF-AI-046',
    'POST',
    '/internal/v1/calibration/gold/{gold_id}:confirm',
    'ai-gateway.calibration.gold_confirm',
    ['gateway'],
    true,
  ],
  ['IF-AI-047', 'POST', '/internal/v1/calibration:run', 'ai-gateway.calibration.run', ['gateway'], true],
  ['IF-AI-050', 'GET', '/internal/v1/firewall/patterns', 'ai-gateway.firewall.patterns', ['content', 'gateway'], false],
  ['IF-AI-051', 'PUT', '/internal/v1/firewall/patterns', 'ai-gateway.firewall.patterns_put', ['gateway'], true],
  ['IF-AI-052', 'GET', '/internal/v1/firewall/log', 'ai-gateway.firewall.log', ['gateway'], false],
  ['IF-AI-053', 'POST', '/internal/v1/firewall:preview', 'ai-gateway.firewall.preview', ['gateway'], false],
];

const FILES = {
  judge: AI_JUDGE_ROUTES,
  generate: AI_GENERATE_ROUTES,
  streams: AI_STREAMS_ROUTES,
  jobs: AI_JOBS_ROUTES,
  workOrders: AI_WORK_ORDERS_ROUTES,
  providers: AI_PROVIDERS_ROUTES,
  secrets: AI_SECRETS_ROUTES,
  usage: AI_USAGE_ROUTES,
  mode: AI_MODE_ROUTES,
  calibration: AI_CALIBRATION_ROUTES,
  firewall: AI_FIREWALL_ROUTES,
};
const ALL: readonly RouteDef[] = Object.values(FILES).flat();
const byIf = new Map<string, RouteDef>(ALL.map((r) => [r.ifId, r]));
const get = (id: string): RouteDef => {
  const r = byIf.get(id);
  if (r === undefined) {
    throw new Error(`route ${id} missing`);
  }
  return r;
};

describe('ai-gateway 라우트 39개(IF-AI)', () => {
  it('UT-CON-148 AI_*_ROUTES 11개 합집합 ifId = §7 표, id 접두 ai-gateway., allowedCallers에 learning 0, 메타(데드라인·kind·bodyKind) 규칙 일치 [FR-AI-004]', () => {
    expect(ALL).toHaveLength(39);
    expect(Object.values(FILES).map((f) => f.length)).toEqual([1, 1, 1, 5, 4, 6, 4, 4, 3, 6, 4]);
    expect(new Set(ALL.map((r) => r.ifId)).size).toBe(39);
    expect(new Set(ALL.map((r) => r.id)).size).toBe(39);
    expect(ALL.map((r) => r.ifId).sort()).toEqual(EXPECTED.map((r) => r[0]).sort());
    for (const [ifId, method, path, id, callers, idem] of EXPECTED) {
      const r = get(ifId);
      expect(r.method, ifId).toBe(method);
      expect(r.path, ifId).toBe(path);
      expect(r.id, ifId).toBe(id);
      expect(r.id.startsWith('ai-gateway.'), ifId).toBe(true);
      expect(r.path.startsWith('/internal/v1/'), ifId).toBe(true);
      expect([...r.allowedCallers], ifId).toEqual(callers);
      expect(r.allowedCallers, ifId).not.toContain('learning'); // v1에서 learning은 ai-gateway를 호출하지 않는다(ACL → 403)
      expect(r.idempotent, ifId).toBe(idem);
    }

    const deadlines: Record<string, number> = { 'IF-AI-001': 10000, 'IF-AI-002': 120000, 'IF-AI-003': 120000 };
    const kinds: Record<string, string> = { 'IF-AI-003': 'sse', 'IF-AI-044': 'ndjson' };
    for (const r of ALL) {
      expect(r.deadlineMs, r.ifId).toBe(deadlines[r.ifId]);
      expect(r.responseKind, r.ifId).toBe(kinds[r.ifId]);
      expect(r.request.bodyKind, r.ifId).toBe(r.ifId === 'IF-AI-045' ? 'ndjson' : undefined);
      expect(r.bodyLimitBytes, r.ifId).toBe(r.ifId === 'IF-AI-045' ? 8_589_934_592 : undefined);
    }
    expect(
      ALL.filter((r) => r.paginated)
        .map((r) => r.ifId)
        .sort(),
    ).toEqual(['IF-AI-011', 'IF-AI-014', 'IF-AI-021', 'IF-AI-036', 'IF-AI-052']);
    // 204 응답(삭제 계열)
    expect(
      ALL.filter((r) => 204 in r.response)
        .map((r) => r.ifId)
        .sort(),
    ).toEqual(['IF-AI-032', 'IF-AI-034']);
    expect(Object.keys(get('IF-AI-029').response)).toEqual(['201']);
    expect(Object.keys(get('IF-AI-010').response)).toEqual(['202']);
    // freeze·slice 샘플(R1(훅·OFFLINE 즉답)·D → R1·D)
    const fs = (id: string) => `${get(id).freeze}${get(id).slice}`;
    expect([fs('IF-AI-001'), fs('IF-AI-002'), fs('IF-AI-025'), fs('IF-AI-026'), fs('IF-AI-050')]).toEqual([
      'DR1',
      'OR2',
      'DR0',
      'DR0',
      'DR1',
    ]);
    expect([...get('IF-AI-026').fr]).toEqual(['FR-AI-001', 'FR-AI-015']); // AQ-15(`doctor --live`)는 설명 조각이라 버린다
    expect([...get('IF-AI-001').fr]).toContain('IR-008');
    expect([...get('IF-AI-002').fr]).toContain('IR-001~007');
    // params 스칼라 매핑
    expect(get('IF-AI-001').request.params?.safeParse({ task_id: 'AI-J03' }).success).toBe(true);
    expect(get('IF-AI-001').request.params?.safeParse({ task_id: 'AI-NOPE-404' }).success).toBe(true); // 없는 과업 = 404(서비스 몫)
    expect(get('IF-AI-001').request.params?.safeParse({ task_id: 'a/b' }).success).toBe(false);
    expect(get('IF-AI-027').request.params?.safeParse({ provider_id: 'jev' }).success).toBe(true);
    expect(get('IF-AI-027').request.params?.safeParse({ provider_id: 'nope' }).success).toBe(false);
    expect(get('IF-AI-046').request.params?.safeParse({ gold_id: 'gold.AI-J03.017' }).success).toBe(true);
    expect(get('IF-AI-046').request.params?.safeParse({ gold_id: 'gold.AI-J3.17' }).success).toBe(false);
    expect(get('IF-AI-003').request.params?.safeParse({ ref: '01HZX3Y5K7M9N2P4Q6R8S0T1V2' }).success).toBe(true);
  });

  it('UT-CON-149 라우트 스키마 동일성: AI-001 body·response, AI-010 body, AI-020 body, AI-021 query [IF-AI-001][IF-AI-010]', () => {
    expect(get('IF-AI-001').request.body).toBe(JudgeRequest);
    expect(get('IF-AI-001').response[200]).toBe(JudgeResult);
    expect(get('IF-AI-002').request.body).toBe(GenerateRequest);
    expect(get('IF-AI-002').response[200]).toBe(GenerateResult);
    expect(get('IF-AI-010').request.body).toBe(CreateJobBody);
    expect(get('IF-AI-020').request.body).toBe(CreateWorkOrderBody);
    expect(get('IF-AI-021').request.query).toBe(WorkOrderListQuery);
    expect(get('IF-AI-044').response[200]).toBe(GoldExportLine);
    expect(get('IF-AI-045').request.body).toBe(GoldExportLine);
    expect(get('IF-AI-045').request.query?.safeParse({ import_id: '01HZX3Y5K7M9N2P4Q6R8S0T1V2' }).success).toBe(true);
  });

  it('UT-CON-150 AI_ERRORS 19키 = §2.6.3 AI 행, AI-DEP-001 status 502, retryable 규칙 [IR-015][STD-ERR-01]', () => {
    const keys = Object.keys(AI_ERRORS);
    expect(keys).toEqual([
      'AI-POLICY-001',
      'AI-POLICY-002',
      'AI-VAL-010',
      'AI-VAL-011',
      'AI-VAL-012',
      'AI-VAL-013',
      'AI-NOTFOUND-001',
      'AI-NOTFOUND-002',
      'AI-NOTFOUND-003',
      'AI-NOTFOUND-004',
      'AI-NOTFOUND-005',
      'AI-NOTFOUND-006',
      'AI-NOTFOUND-007',
      'AI-CONFLICT-010',
      'AI-CONFLICT-011',
      'AI-CONFLICT-012',
      'AI-DEP-001',
      'AI-DEP-002',
      'AI-DEP-003',
    ]);
    expect(keys).toHaveLength(19);
    for (const [code, e] of Object.entries(AI_ERRORS)) {
      expect(code).toMatch(/^AI-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/);
      expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
      expect(e.title.length, code).toBeGreaterThan(0);
    }
    expect(AI_ERRORS['AI-DEP-001'].status).toBe(502); // 스트림 error 이벤트 전용
    expect(AI_ERRORS['AI-DEP-002'].status).toBe(504);
    expect(AI_ERRORS['AI-DEP-003'].status).toBe(503);
    expect(AI_ERRORS['AI-DEP-001'].retryable).toBe(true);
    expect(AI_ERRORS['AI-POLICY-001']).toEqual({ status: 403, title: '제출 전 생성 금지', retryable: false });
    expect(AI_ERRORS['AI-VAL-010'].status).toBe(422);
    expect(AI_ERRORS['AI-CONFLICT-012'].status).toBe(409);
    // 스트림의 error 이벤트 code(StreamError.code)는 전부 레지스트리에 있다
    for (const c of ['AI-DEP-001', 'AI-DEP-002', 'AI-DEP-003']) {
      expect(keys).toContain(c);
    }
  });
});
