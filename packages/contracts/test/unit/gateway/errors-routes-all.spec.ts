import { describe, expect, it } from 'vitest';
import { COMMON_ERRORS, commonErrorCode } from '../../../src/common/errors.js';
import { ErrorCode } from '../../../src/common/problem.js';
import { AI_ERRORS } from '../../../src/http/ai-gateway/v1/errors.js';
import { CT_ERRORS } from '../../../src/http/content/v1/errors.js';
import { GW_ERRORS } from '../../../src/http/gateway/v1/errors.js';
import { LR_ERRORS } from '../../../src/http/learning/v1/errors.js';
import { OP_ERRORS } from '../../../src/http/ops/v1/errors.js';
import { AI_ALL, ALL_ROUTES, COM_ALL, CT_ALL, GW_ALL, LR_ALL, OP_ALL } from './all-routes.js';
import {
  EXPECTED_AI_CODES,
  EXPECTED_CT_CODES,
  EXPECTED_GW_CODES,
  EXPECTED_LR_CODES,
  EXPECTED_OP_CODES,
} from './expected-errors.js';

// STD-NAM-90 — 서비스 고유 오류 코드 `<SVC>-<CAT>-<NNN>`(CLI-* 3개는 apps/cli 소유라 이 레지스트리에 없다).
const CODE_RE = /^(GW|CT|LR|AI|OP)-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/;
const FR_RE = /^[A-Z]{1,4}(-[A-Z0-9*~]+)+$/;

describe('전 서비스 오류 레지스트리 · 전 라우트 386개 교차 점검', () => {
  it('UT-CON-210 COMMON_ERRORS + CT·LR·AI·OP·GW 레지스트리: 서비스 코드 92개 = §2.6.3 비-CLI 행 전부·중복 0·STD-NAM-90 정규식 [STD-ERR-01][STD-ERR-04]', () => {
    const registries = { CT: CT_ERRORS, LR: LR_ERRORS, AI: AI_ERRORS, OP: OP_ERRORS, GW: GW_ERRORS };
    const expected = {
      CT: EXPECTED_CT_CODES,
      LR: EXPECTED_LR_CODES,
      AI: EXPECTED_AI_CODES,
      OP: EXPECTED_OP_CODES,
      GW: EXPECTED_GW_CODES,
    };
    expect(Object.keys(CT_ERRORS)).toEqual(EXPECTED_CT_CODES);
    expect(Object.keys(AI_ERRORS)).toEqual(EXPECTED_AI_CODES);
    expect(Object.keys(OP_ERRORS)).toEqual(EXPECTED_OP_CODES);
    expect(Object.keys(LR_ERRORS)).toEqual(EXPECTED_LR_CODES);
    expect(Object.keys(GW_ERRORS)).toEqual(EXPECTED_GW_CODES);
    expect(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.length]))).toEqual({
      CT: 26,
      LR: 24,
      AI: 19,
      OP: 9,
      GW: 14,
    });
    const all = Object.values(registries).flatMap((r) => Object.keys(r));
    expect(all).toHaveLength(92);
    expect(new Set(all).size).toBe(92); // 서비스 사이 중복 0
    for (const [svc, reg] of Object.entries(registries)) {
      for (const [code, e] of Object.entries(reg)) {
        expect(CODE_RE.test(code), code).toBe(true);
        expect(code.startsWith(`${svc}-`), code).toBe(true);
        expect(ErrorCode.safeParse(code).success, code).toBe(true);
        expect(Number.isInteger(e.status) && e.status >= 400 && e.status < 600, code).toBe(true);
        expect(e.title.length, code).toBeGreaterThan(0);
        expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
      }
    }
    // CLI-* 3개는 등록하지 않는다(apps/cli/src/lib/exit-codes.ts 소유)
    expect(all.some((c) => c.startsWith('CLI-'))).toBe(false);
    // 공통 17개는 접미 키 — 서비스 코드와 합쳐도 충돌 없이 `<SVC>-<접미>`로 합성된다.
    expect(Object.keys(COMMON_ERRORS)).toHaveLength(17);
    for (const svc of ['GW', 'CT', 'LR', 'AI', 'OP'] as const) {
      for (const suffix of Object.keys(COMMON_ERRORS) as (keyof typeof COMMON_ERRORS)[]) {
        const code = commonErrorCode(svc, suffix);
        expect(CODE_RE.test(code), code).toBe(true);
        expect(all.includes(code), code).toBe(false);
      }
    }
  });

  it('UT-CON-212 전 서비스 라우트 386개(IF-COM 10 + GW 179 + LR 75 + CT 55 + AI 39 + OP 28): ifId·id 전역 중복 0·서비스별 (method, path) 중복 0·freeze D ⇔ slice R0·R1 [IR-015]', () => {
    expect([COM_ALL.length, GW_ALL.length, LR_ALL.length, CT_ALL.length, AI_ALL.length, OP_ALL.length]).toEqual([
      10, 179, 75, 55, 39, 28,
    ]);
    expect(ALL_ROUTES).toHaveLength(386);
    expect(new Set(ALL_ROUTES.map((r) => r.ifId)).size).toBe(386);
    expect(new Set(ALL_ROUTES.map((r) => r.id)).size).toBe(386);
    const perSvc = new Set<string>();
    for (const r of ALL_ROUTES) {
      const svc = r.ifId.split('-')[1];
      const key = `${svc} ${r.method} ${r.path}`;
      expect(perSvc.has(key), key).toBe(false);
      perSvc.add(key);
      expect(r.freeze === 'D', r.ifId).toBe(r.slice === 'R0' || r.slice === 'R1');
      expect(['D', 'O'].includes(r.freeze), r.ifId).toBe(true);
      expect(['R0', 'R1', 'R2', 'R3'].includes(r.slice), r.ifId).toBe(true);
      expect(r.id.length > 0, r.ifId).toBe(true);
      // 무인증 /healthz·/readyz(IF-COM-001·002)만 호출자가 비어 있다(§2.11 예외 경로)
      expect(r.allowedCallers.length === 0, r.ifId).toBe(r.ifId === 'IF-COM-001' || r.ifId === 'IF-COM-002');
    }
    // 서비스 접두 ↔ route id 접두
    const idPrefix = {
      COM: '',
      GW: 'gateway.',
      LR: 'learning.',
      CT: 'content.',
      AI: 'ai-gateway.',
      OP: 'ops.',
    } as const;
    for (const r of ALL_ROUTES) {
      const svc = r.ifId.split('-')[1] as keyof typeof idPrefix;
      if (svc !== 'COM') {
        expect(r.id.startsWith(idPrefix[svc]), r.ifId).toBe(true);
      }
    }
  });

  it('UT-CON-213 모든 라우트 fr 토큰이 정규식 형태(`·` 남지 않음)·idempotent: true인 GET 0 [STD-API-02][STD-API-30]', () => {
    for (const r of ALL_ROUTES) {
      for (const t of r.fr) {
        expect(FR_RE.test(t), `${r.ifId} ${t}`).toBe(true);
        expect(t.includes('·'), `${r.ifId} ${t}`).toBe(false);
      }
      if (r.idempotent) {
        expect(r.method, r.ifId).not.toBe('GET');
      }
      if (r.method === 'GET') {
        expect(r.idempotent, r.ifId).toBe(false);
      }
    }
    // learning·gateway 라우트는 FR이 비어 있지 않다(내부 활동 라우트 IF-GW-199 = 표에 FR 열 없음 제외)
    for (const r of [...GW_ALL, ...LR_ALL]) {
      if (r.ifId !== 'IF-GW-199') {
        expect(r.fr.length, r.ifId).toBeGreaterThan(0);
      }
    }
    // 설명 문장이 토큰에 섞이지 않음(공백·괄호·한글 금지)
    expect(ALL_ROUTES.flatMap((r) => r.fr).some((t) => /[\s()가-힣]/.test(t))).toBe(false);
  });
});
