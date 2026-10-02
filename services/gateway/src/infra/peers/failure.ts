import type { Problem } from '@fathom/contracts/common/problem';
import type { ErrorCodeString, ProblemExtras } from '@fathom/shared-kernel/errors/errors';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { PeerFailure } from '@fathom/shared-kernel/http-client/http-client';
import type { Logger } from '@fathom/shared-kernel/log/log';

// 하위 호출 실패 → AppError. 하위 Problem은 원 코드·상태 그대로 통과한다(STD-API-04, IF §4.1) — 합성 0.

const CODE_RE = /^(GW|CT|LR|AI|OP|CLI)-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/;

function isErrorCode(code: string): code is ErrorCodeString {
  return CODE_RE.test(code);
}

function extrasOf(p: Problem): ProblemExtras | undefined {
  const extra: {
    -readonly [K in keyof ProblemExtras]: ProblemExtras[K];
  } = {};
  if (p.errors !== undefined) {
    extra.errors = p.errors;
  }
  if (p.dependency !== undefined) {
    extra.dependency = p.dependency;
  }
  if (p.retry_after_ms !== undefined) {
    extra.retry_after_ms = p.retry_after_ms;
  }
  if (p.acked_through_seq !== undefined) {
    extra.acked_through_seq = p.acked_through_seq;
  }
  if (p.active_session_id !== undefined) {
    extra.active_session_id = p.active_session_id;
  }
  if (p.violations !== undefined) {
    extra.violations = p.violations;
  }
  return Object.keys(extra).length === 0 ? undefined : extra;
}

export function peerFailureToAppError(f: PeerFailure, log?: Logger): AppError {
  switch (f.kind) {
    case 'connect_failed':
    case 'connect_timeout':
    case 'circuit_open':
      return new AppError('GW-DEP-001', 503, '하위 서비스에 연결할 수 없다.', { extra: { dependency: f.dependency } });
    case 'timeout':
    case 'deadline_exhausted':
      return new AppError('GW-DEP-902', 504, '하위 서비스 응답이 데드라인을 넘었다.', {
        extra: { dependency: f.dependency },
      });
    case 'problem': {
      const p = f.problem;
      if (!isErrorCode(p.code)) {
        log?.error(
          { event: 'gateway.peer.unknown_problem_code', dependency: f.dependency, status: p.status },
          'peer problem code outside the registry',
        );
        return new AppError('GW-INTERNAL-900', 500);
      }
      const extra = extrasOf(p);
      return new AppError(p.code, p.status, p.detail, extra === undefined ? undefined : { extra });
    }
    case 'contract_violation':
      log?.error(
        { event: 'gateway.peer.contract_violation', dependency: f.dependency, status: f.status },
        'peer response violates contract',
      );
      return new AppError('GW-INTERNAL-900', 500);
  }
}
