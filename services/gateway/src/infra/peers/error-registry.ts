import type { CommonErrorSuffix, ErrorRegistry, SvcCode } from '@fathom/contracts/common/errors';
import { COMMON_ERRORS, commonErrorCode } from '@fathom/contracts/common/errors';
import { AI_ERRORS } from '@fathom/contracts/http/ai-gateway/v1/errors';
import { CT_ERRORS } from '@fathom/contracts/http/content/v1/errors';
import { GW_ERRORS } from '@fathom/contracts/http/gateway/v1/errors';
import { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';
import { OP_ERRORS } from '@fathom/contracts/http/ops/v1/errors';

// 통과 레지스트리 — 하위 서비스 Problem이 `toProblem`의 "미등록 코드 → INTERNAL-900"에 걸리지 않게 하위 코드를 모두 등록한다(Brief 결정).
// GW 공통 17개는 createService가 자동 포함한다.

const PEER_SVC: readonly SvcCode[] = ['CT', 'LR', 'AI', 'OP'];

function isCommonSuffix(s: string): s is CommonErrorSuffix {
  return s in COMMON_ERRORS;
}

/** `COMMON_ERRORS`의 접미 17개를 `<SVC>-<접미>`로 펼친다. */
function commonOf(svc: SvcCode): ErrorRegistry {
  const out: Record<string, ErrorRegistry[string]> = {};
  for (const [suffix, entry] of Object.entries(COMMON_ERRORS)) {
    if (isCommonSuffix(suffix)) {
      out[commonErrorCode(svc, suffix)] = entry;
    }
  }
  return out;
}

export function buildGatewayErrorRegistry(): ErrorRegistry {
  const out: Record<string, ErrorRegistry[string]> = {};
  const sources: readonly ErrorRegistry[] = [
    GW_ERRORS,
    CT_ERRORS,
    LR_ERRORS,
    AI_ERRORS,
    OP_ERRORS,
    ...PEER_SVC.map(commonOf),
  ];
  for (const source of sources) {
    for (const [code, entry] of Object.entries(source)) {
      if (code in out) {
        throw new Error(`invariant: duplicate error code ${code} in gateway registry`);
      }
      out[code] = entry;
    }
  }
  return out;
}

export const GATEWAY_ERROR_REGISTRY: ErrorRegistry = buildGatewayErrorRegistry();
