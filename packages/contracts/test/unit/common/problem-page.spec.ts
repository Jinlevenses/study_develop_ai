import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DegradedPart } from '../../../src/common/degraded.js';
import type { CommonErrorSuffix, ErrorRegistry } from '../../../src/common/errors.js';
import { COMMON_ERRORS, commonErrorCode, SVC_CODE_OF } from '../../../src/common/errors.js';
import { ServiceName } from '../../../src/common/ids.js';
import { NdjsonEnd } from '../../../src/common/ndjson.js';
import { Cursor, Page, PageQuery } from '../../../src/common/pagination.js';
import { ErrorCode, FieldError, Problem } from '../../../src/common/problem.js';
import { defineRoute } from '../../../src/common/route.js';
import { S } from '../../../src/common/schema.js';

const ULID_A = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';

describe('common/problem', () => {
  it('UT-CON-020 Problem은 urn type·ErrorCode·strict를 강제한다 [NFR-SEC-012]', () => {
    const base = {
      type: 'urn:fathom:problem:lr-dep-902',
      title: '데드라인 소진',
      status: 504,
      code: 'LR-DEP-902',
      error_id: ULID_A,
      request_id: ULID_B,
      retryable: true,
    };
    expect(Problem.safeParse(base).success).toBe(true);
    expect(
      Problem.safeParse({
        ...base,
        detail: '잠시 후 다시 시도하세요',
        instance: '/internal/v1/x',
        retry_after_ms: 1000,
        errors: [{ path: 'a.b', message: 'm', rule: 'min' }],
        dependency: 'content',
        acked_through_seq: 3,
        active_session_id: ULID_A,
        violations: [{ k: 1 }],
      }).success,
    ).toBe(true);
    expect(Problem.safeParse({ ...base, stack: 'trace' }).success).toBe(false); // 미지 키
    expect(Problem.safeParse({ ...base, type: 'LR-DEP-902' }).success).toBe(false);
    expect(Problem.safeParse({ ...base, type: 'urn:fathom:problem:lr-dep-9' }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 200 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, status: 600 }).success).toBe(false);
    expect(Problem.safeParse({ ...base, dependency: 'browser' }).success).toBe(false);

    for (const ok of [
      'LR-DEP-902',
      'GW-VAL-900',
      'CLI-AUTH-001',
      'OP-INTERNAL-901',
      'AI-POLICY-010',
      'CT-NOTFOUND-010',
    ]) {
      expect(ErrorCode.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['XX-DEP-902', 'LR-DEP-92', 'LR-DEP-9022', 'lr-dep-902', 'LR-FOO-902', 'LR_DEP_902']) {
      expect(ErrorCode.safeParse(bad).success, bad).toBe(false);
    }
    expect(FieldError.safeParse({ path: 'a', message: 'm', rule: 'r' }).success).toBe(true);
    expect(FieldError.safeParse({ path: 'a', message: 'm' }).success).toBe(false);
  });
});

describe('common/pagination', () => {
  it('UT-CON-021 PageQuery limit 기본 50·coerce·201 거부, Page(X) 모양 [IR-015]', () => {
    expect(PageQuery.parse({})).toEqual({ limit: 50 });
    expect(PageQuery.parse({ limit: '7' }).limit).toBe(7);
    expect(PageQuery.parse({ limit: 200, cursor: 'abc_-9' })).toEqual({ limit: 200, cursor: 'abc_-9' });
    expect(PageQuery.safeParse({ limit: 201 }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(PageQuery.safeParse({ cursor: 'a b' }).success).toBe(false);
    expect(PageQuery.safeParse({ extra: 1 }).success).toBe(false);
    expect(Cursor.safeParse('A'.repeat(512)).success).toBe(true);
    expect(Cursor.safeParse('A'.repeat(513)).success).toBe(false);
    expect(Cursor.safeParse('').success).toBe(false);

    const Items = Page(z.object({ id: z.string() }));
    expect(Items.parse({ items: [{ id: 'a' }], next_cursor: null })).toEqual({
      items: [{ id: 'a' }],
      next_cursor: null,
    });
    expect(Items.safeParse({ items: [], next_cursor: 'abc' }).success).toBe(true);
    expect(Items.safeParse({ items: [] }).success).toBe(false); // next_cursor 필수(null 허용)
    expect(Items.safeParse({ items: [{ id: 1 }], next_cursor: null }).success).toBe(false);
    expect(Items.safeParse({ items: [], next_cursor: null, total: 1 }).success).toBe(false);
  });
});

describe('common/degraded·ndjson', () => {
  it('UT-CON-022 DegradedPart·NdjsonEnd 형식 [IR-015]', () => {
    const part = { part: 'home.ai_chip', dependency: 'ai-gateway', code: 'GW-DEP-001' };
    expect(DegradedPart.safeParse(part).success).toBe(true);
    expect(DegradedPart.safeParse({ ...part, part: 'Home' }).success).toBe(false);
    expect(DegradedPart.safeParse({ ...part, part: 'h' }).success).toBe(false);
    expect(DegradedPart.safeParse({ ...part, dependency: 'cli' }).success).toBe(false);
    expect(DegradedPart.safeParse({ ...part, code: 'ZZ-DEP-001' }).success).toBe(false);
    expect(DegradedPart.safeParse({ ...part, extra: 1 }).success).toBe(false);

    const end = { kind: 'end', count: 0, sha256: 'a'.repeat(64) };
    expect(NdjsonEnd.safeParse(end).success).toBe(true);
    expect(NdjsonEnd.safeParse({ ...end, kind: 'header' }).success).toBe(false);
    expect(NdjsonEnd.safeParse({ ...end, count: -1 }).success).toBe(false);
    expect(NdjsonEnd.safeParse({ ...end, sha256: 'xyz' }).success).toBe(false);
  });
});

describe('common/route·schema', () => {
  it('UT-CON-023 defineRoute는 항등이고 S는 알 수 없는 키를 거부한다 [IR-015]', () => {
    const def = {
      id: 'x.y.z',
      ifId: 'IF-COM-099',
      method: 'GET',
      path: '/internal/v1/x',
      allowedCallers: ['ops-api'],
      idempotent: false,
      paginated: false,
      request: {},
      response: { 200: z.string() },
      freeze: 'D',
      slice: 'R0',
      fr: [],
    } as const;
    const out = defineRoute(def);
    expect(out).toBe(def);
    expect(out.id).toBe('x.y.z');

    const Obj = S({ a: z.string() });
    expect(Obj.safeParse({ a: 'x' }).success).toBe(true);
    expect(Obj.safeParse({ a: 'x', b: 1 }).success).toBe(false);
    expect(Obj.safeParse({}).success).toBe(false);
  });
});

describe('common/errors', () => {
  // 독립 기대표: IF-01 §2.6.2 · Brief §4.2 (키, status, retryable, title)
  const EXPECTED = [
    ['VAL-900', 400, false, '요청 스키마 위반'],
    ['VAL-901', 400, false, 'Idempotency-Key 없음 또는 형식 오류'],
    ['VAL-903', 400, false, '커서 무효 또는 만료'],
    ['VAL-904', 415, false, '지원하지 않는 Content-Type'],
    ['AUTH-900', 401, false, '내부 호출자 토큰 없음 또는 무효'],
    ['ACL-900', 403, false, '허용되지 않은 호출자'],
    ['NOTFOUND-900', 404, false, '정의되지 않은 라우트'],
    ['CONFLICT-001', 422, false, '같은 Idempotency-Key에 다른 본문'],
    ['CONFLICT-002', 409, true, '같은 키의 요청이 처리 중'],
    ['LIMIT-900', 413, false, '본문 크기 초과'],
    ['LIMIT-901', 429, true, '요청 한도 초과'],
    ['DEP-900', 503, true, '정지 중 또는 쓰기 게이트 닫힘'],
    ['DEP-901', 503, true, '준비되지 않음'],
    ['DEP-902', 504, true, '데드라인 소진'],
    ['DEP-910', 503, true, 'inbox 원장 경로 정지'],
    ['INTERNAL-900', 500, false, '처리되지 않은 서버 오류'],
    ['INTERNAL-901', 500, false, '응답이 계약을 위반함'],
  ] as const;

  it('UT-CON-024 COMMON_ERRORS는 17행이고 status·retryable·title이 표와 같다 [NFR-SEC-012]', () => {
    expect(Object.keys(COMMON_ERRORS)).toHaveLength(17);
    const registry: ErrorRegistry = COMMON_ERRORS;
    for (const [key, status, retryable, title] of EXPECTED) {
      expect(registry[key], key).toEqual({ status, retryable, title });
    }
    // 모든 접미가 어떤 SVC와 합쳐도 유효한 ErrorCode다.
    for (const key of Object.keys(COMMON_ERRORS)) {
      expect(ErrorCode.safeParse(`GW-${key}`).success, key).toBe(true);
    }
  });

  it("UT-CON-025 commonErrorCode('LR','DEP-902') = 'LR-DEP-902', SVC_CODE_OF는 5서비스를 덮는다 [IR-015]", () => {
    expect(commonErrorCode('LR', 'DEP-902')).toBe('LR-DEP-902');
    expect(commonErrorCode('GW', 'VAL-900')).toBe('GW-VAL-900');
    expect(commonErrorCode('OP', 'INTERNAL-901')).toBe('OP-INTERNAL-901');
    const suffixes = Object.keys(COMMON_ERRORS) as CommonErrorSuffix[];
    for (const svc of Object.values(SVC_CODE_OF)) {
      for (const suffix of suffixes) {
        expect(ErrorCode.safeParse(commonErrorCode(svc, suffix)).success).toBe(true);
      }
    }
    expect(SVC_CODE_OF).toEqual({ gateway: 'GW', content: 'CT', learning: 'LR', 'ai-gateway': 'AI', 'ops-api': 'OP' });
    expect(Object.keys(SVC_CODE_OF).sort()).toEqual([...ServiceName.options].sort());
  });
});
