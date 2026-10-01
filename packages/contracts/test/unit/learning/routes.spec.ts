import { describe, expect, it, vi } from 'vitest';
import { PageQuery } from '../../../src/common/pagination.js';
import { ErrorCode } from '../../../src/common/problem.js';
import type { RouteDef } from '../../../src/common/route.js';
import { SelfGradeBody, SubmitAttemptBody } from '../../../src/http/learning/v1/attempts.js';
import { LR_DIALOGS_ROUTES } from '../../../src/http/learning/v1/dialogs.js';
import { LR_ERRORS } from '../../../src/http/learning/v1/errors.js';
import { LR_INSIGHT_ROUTES, PortfolioQuery, WeeklyQuery } from '../../../src/http/learning/v1/insight.js';
import { CalibrationQuery, LR_LEARNER_ROUTES } from '../../../src/http/learning/v1/learner.js';
import {
  LedgerExportLine,
  LedgerExportQuery,
  LedgerImportQuery,
  LedgerImportView,
  LR_LEDGER_ROUTES,
} from '../../../src/http/learning/v1/ledger.js';
import { LR_LONGTASKS_ROUTES } from '../../../src/http/learning/v1/longtasks.js';
import { LR_NOTES_ROUTES, NoteView } from '../../../src/http/learning/v1/notes.js';
import { AttemptOutcomePostSubmit } from '../../../src/http/learning/v1/post-submit/attempt.js';
import { BlockViewPreSubmit } from '../../../src/http/learning/v1/pre-submit/block.js';
import { LR_SEASONS_ROUTES } from '../../../src/http/learning/v1/seasons.js';
import { LR_SESSIONS_ROUTES } from '../../../src/http/learning/v1/sessions.js';
import { LR_SETTINGS_ROUTES } from '../../../src/http/learning/v1/settings.js';
import { LR_TELEMETRY_ROUTES, SignalsQuery } from '../../../src/http/learning/v1/telemetry.js';
import { EXPECTED_LR_CODES } from '../gateway/expected-errors.js';
import { EXPECTED_LR_ROUTES } from './expected-routes.js';
import { ULID } from './samples.js';

const GROUPS: Readonly<Record<string, readonly RouteDef[]>> = {
  sessions: LR_SESSIONS_ROUTES,
  dialogs: LR_DIALOGS_ROUTES,
  notes: LR_NOTES_ROUTES,
  longtasks: LR_LONGTASKS_ROUTES,
  seasons: LR_SEASONS_ROUTES,
  learner: LR_LEARNER_ROUTES,
  insight: LR_INSIGHT_ROUTES,
  settings: LR_SETTINGS_ROUTES,
  ledger: LR_LEDGER_ROUTES,
  telemetry: LR_TELEMETRY_ROUTES,
};
const ALL = Object.values(GROUPS).flat();
const byIf = new Map(ALL.map((r) => [r.ifId, r]));
const route = (ifId: string): RouteDef => {
  const r = byIf.get(ifId as RouteDef['ifId']);
  if (r === undefined) {
    throw new Error(`missing ${ifId}`);
  }
  return r;
};

describe('learning 라우트 75개 · 오류 레지스트리 · 순환 import', () => {
  it('UT-CON-190 LR_*_ROUTES 10개 합집합 = §5 표 75행(ifId·메서드·경로·id·멱등·데드라인·호출자·NDJSON 규칙) [IR-015]', () => {
    expect(Object.values(GROUPS).map((g) => g.length)).toEqual([19, 4, 2, 9, 2, 12, 7, 11, 8, 1]);
    expect(ALL).toHaveLength(75);
    expect(new Set(ALL.map((r) => r.ifId)).size).toBe(75);
    expect(new Set(EXPECTED_LR_ROUTES.map((r) => r[0]))).toEqual(new Set(ALL.map((r) => r.ifId)));
    for (const [ifId, method, path, id, idempotent, deadlineMs, paginated] of EXPECTED_LR_ROUTES) {
      const r = route(ifId);
      expect(r.method, ifId).toBe(method);
      expect(r.path, ifId).toBe(path);
      expect(r.id, ifId).toBe(id);
      expect(r.idempotent, ifId).toBe(idempotent);
      expect(r.deadlineMs ?? null, ifId).toBe(deadlineMs);
      expect(r.paginated, ifId).toBe(paginated);
      expect(r.id.startsWith('learning.'), ifId).toBe(true);
      expect(r.path.startsWith('/internal/v1/'), ifId).toBe(true);
      const opsApi = r.path.startsWith('/internal/v1/ledger/') || r.path.startsWith('/internal/v1/telemetry/');
      expect(r.allowedCallers, ifId).toEqual(opsApi ? ['ops-api'] : ['gateway']);
      expect(['D', 'O'].includes(r.freeze), ifId).toBe(true);
      expect(r.freeze === 'D', ifId).toBe(r.slice === 'R0' || r.slice === 'R1');
      expect(Object.keys(r.response).length, ifId).toBe(1);
    }
    // 데드라인 11개(§4.3), 나머지는 기본(2000) 사용 = 생략
    expect(ALL.filter((r) => r.deadlineMs !== undefined).map((r) => [r.ifId, r.deadlineMs])).toEqual([
      ['IF-LR-001', 2000],
      ['IF-LR-010', 2900],
      ['IF-LR-011', 2900],
      ['IF-LR-022', 3400],
      ['IF-LR-035', 2900],
      ['IF-LR-036', 2900],
      ['IF-LR-055', 1200],
      ['IF-LR-056', 1200],
      ['IF-LR-061', 10000],
      ['IF-LR-065', 60000],
      ['IF-LR-090', 5000],
    ]);
    // 경로 {name} = request.params 키
    for (const r of ALL) {
      const names = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const params = r.request.params as { shape?: Record<string, unknown> } | undefined;
      expect(Object.keys(params?.shape ?? {}), r.ifId).toEqual(names);
    }
    // NDJSON(E4): 080 응답 줄 스키마 · 081 본문 줄 스키마, 데드라인 생략
    const exp = route('IF-LR-080');
    expect(exp.responseKind).toBe('ndjson');
    expect(exp.response[200]).toBe(LedgerExportLine);
    expect(exp.request.query).toBe(LedgerExportQuery);
    expect(exp.deadlineMs).toBeUndefined();
    const imp = route('IF-LR-081');
    expect(imp.request.bodyKind).toBe('ndjson');
    expect(imp.request.body).toBe(LedgerExportLine);
    expect(imp.request.query).toBe(LedgerImportQuery);
    expect(imp.bodyLimitBytes).toBe(8_589_934_592);
    expect(imp.response[202]).toBe(LedgerImportView);
    expect(imp.deadlineMs).toBeUndefined();
    expect(ALL.filter((r) => r.responseKind !== undefined).map((r) => r.ifId)).toEqual(['IF-LR-080']);
    // 스키마 연결(재정의 금지 — 같은 객체)
    expect(route('IF-LR-010').request.body).toBe(SubmitAttemptBody);
    expect(route('IF-LR-010').response[200]).toBe(AttemptOutcomePostSubmit);
    expect(route('IF-LR-011').request.body).toBe(SelfGradeBody);
    expect(route('IF-LR-024').response[200]).toBe(NoteView);
    expect(route('IF-LR-004').response[200]).toBe(BlockViewPreSubmit);
    expect(route('IF-LR-042').request.query).toBe(PageQuery);
    expect(route('IF-LR-084').request.query).toBe(PageQuery);
    expect(route('IF-LR-047').request.query).toBe(CalibrationQuery);
    expect(route('IF-LR-057').request.query).toBe(WeeklyQuery);
    expect(route('IF-LR-061').request.query).toBe(PortfolioQuery);
    expect(route('IF-LR-090').request.query).toBe(SignalsQuery);
    // 파라미터 파싱 예: ULID·카드·주
    expect(
      (route('IF-LR-058').request.params as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
        week: '2026-W40',
      }).success,
    ).toBe(true);
    expect(
      (route('IF-LR-049').request.params as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
        card_id: 'k8s.probes:concept:r',
      }).success,
    ).toBe(true);
    expect(
      (route('IF-LR-003').request.params as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
        session_id: ULID,
      }).success,
    ).toBe(true);
    expect(
      (route('IF-LR-003').request.params as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
        session_id: ULID,
        x: 1,
      }).success,
    ).toBe(false);
  });

  it('UT-CON-191 LR_ERRORS 24키 = §2.6.3 LR 행·LR-CONFLICT-020 422·retryable 규칙 [STD-ERR-01]', () => {
    expect(Object.keys(LR_ERRORS)).toEqual(EXPECTED_LR_CODES);
    expect(EXPECTED_LR_CODES).toHaveLength(24);
    expect(LR_ERRORS['LR-CONFLICT-020'].status).toBe(422);
    expect(LR_ERRORS['LR-VAL-010'].status).toBe(422);
    expect(LR_ERRORS['LR-INTERNAL-001'].status).toBe(500);
    expect(LR_ERRORS['LR-DEP-001'].status).toBe(503);
    for (const [code, e] of Object.entries(LR_ERRORS)) {
      expect(ErrorCode.safeParse(code).success, code).toBe(true);
      expect(e.title.length, code).toBeGreaterThan(0);
      expect(e.title.includes('`') || e.title.includes('('), code).toBe(false);
      expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
    }
    expect(
      Object.entries(LR_ERRORS)
        .filter(([, e]) => e.retryable)
        .map(([c]) => c),
    ).toEqual(['LR-DEP-001']);
  });

  it('UT-CON-192 순환 E1(sessions ↔ pre-submit/block) 양방향 로드 throw 0·getter 정상 [FR-STD-010][IF-LR-004]', async () => {
    const blockSample = {
      session_id: ULID,
      block: {
        block_id: ULID,
        ord: 0,
        slot: 'W',
        mode_id: 'M-01',
        kind: 'jol',
        concept_id: null,
        reason_chips: [],
        locked: false,
        state: 'pending',
        est_minutes: 1,
        item_count: 0,
        done_count: 0,
        wildcard: null,
        boss: false,
      },
      payload: { kind: 'jol', concept_ids: ['k8s.probes'] },
    };
    {
      vi.resetModules();
      const s1 = await import('../../../src/http/learning/v1/sessions.js');
      const b1 = await import('../../../src/http/learning/v1/pre-submit/block.js');
      expect(s1.PracticeBlocksGetRoute.response[200]).toBe(b1.BlockViewPreSubmit);
      expect(b1.BlockViewPreSubmit.shape.block).toBe(s1.BlockSummary);
      expect(b1.BlockViewPreSubmit.safeParse(blockSample).success).toBe(true);
      expect(
        b1.BlockViewPreSubmit.safeParse({ ...blockSample, block: { ...blockSample.block, extra: 1 } }).success,
      ).toBe(false);
    }
    {
      vi.resetModules();
      const b2 = await import('../../../src/http/learning/v1/pre-submit/block.js');
      const s2 = await import('../../../src/http/learning/v1/sessions.js');
      expect(s2.PracticeBlocksGetRoute.response[200]).toBe(b2.BlockViewPreSubmit);
      expect(b2.BlockViewPreSubmit.shape.block).toBe(s2.BlockSummary);
      expect(b2.BlockViewPreSubmit.safeParse(blockSample).success).toBe(true);
    }
    {
      // 게이트웨이 라우트가 먼저 로드돼도(블록 ← 세션 순환의 바깥쪽 진입) 같은 객체를 쓴다.
      vi.resetModules();
      const g = await import('../../../src/http/gateway/v1/sessions.js');
      const b = await import('../../../src/http/learning/v1/pre-submit/block.js');
      const blockRoute = g.GW_SESSIONS_ROUTES.find((r) => r.ifId === 'IF-GW-018');
      expect(blockRoute?.response[200]).toBe(b.BlockViewPreSubmit);
    }
  });
});
