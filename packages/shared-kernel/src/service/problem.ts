import type { CommonErrorSuffix, ErrorRegistry } from '@fathom/contracts/common/errors';
import { COMMON_ERRORS, SVC_CODE_OF } from '@fathom/contracts/common/errors';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { Problem } from '@fathom/contracts/common/problem';
import type { ErrorCodeString } from '@fathom/shared-kernel/errors/errors';
import { AppError } from '@fathom/shared-kernel/errors/errors';

// IF-01 §2.5·§2.6 · STD-ERR-03·10·11 — 모든 오류는 이 변환기를 거쳐 RFC 9457 problem+json이 된다.

export type ProblemContext = {
  readonly svc: ServiceName;
  readonly requestId: string;
  readonly instance: string;
  readonly registry: ErrorRegistry;
  readonly newId: () => string;
};
export type ProblemResult = {
  readonly status: number;
  readonly body: Problem;
  readonly level: 'info' | 'warn' | 'error';
  readonly errorId: string;
  readonly logStack: boolean;
  /** 로그 msg(결함 사유 포함). 응답에는 쓰지 않는다. */
  readonly logMsg: string;
};

/** `<SVC>-<접미>` 공통 코드 — 서비스 이름 + 공통 접미(`VAL-900` …). */
export function appErrorCode(svc: ServiceName, suffix: CommonErrorSuffix): ErrorCodeString {
  return `${SVC_CODE_OF[svc]}-${suffix}`;
}

/** `COMMON_ERRORS`를 `<SVC>-<접미>`로 펼치고 서비스 고유 코드를 더한 레지스트리. */
export function buildErrorRegistry(svc: ServiceName, own: ErrorRegistry | undefined): ErrorRegistry {
  const entries: [string, ErrorRegistry[string]][] = Object.entries(COMMON_ERRORS).map(([suffix, entry]) => [
    `${SVC_CODE_OF[svc]}-${suffix}`,
    entry,
  ]);
  return { ...Object.fromEntries(entries), ...(own ?? {}) };
}

// 심층 방어 위생 검사 [Brief 결정] — 스택·절대 경로·SQL이 든 문구는 응답에 싣지 않는다.
const STACK_RE = /\n\s+at\s/;
const ABS_PATH_RE = /(^|[\s'"(])(\/(home|Users|tmp|var|etc|opt|root)\/|[A-Za-z]:\\)/;
const SQL_RE = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/;

export function isHygienic(text: string): boolean {
  return !(STACK_RE.test(text) || ABS_PATH_RE.test(text) || SQL_RE.test(text));
}

const FALLBACK_SUFFIX: CommonErrorSuffix = 'INTERNAL-900';

function pathOnly(instance: string): string {
  const q = instance.indexOf('?');
  return (q >= 0 ? instance.slice(0, q) : instance).slice(0, 300);
}

function minimalBody(ctx: ProblemContext, errorId: string, instance: string): Problem {
  const code = appErrorCode(ctx.svc, FALLBACK_SUFFIX);
  const entry = ctx.registry[code] ?? COMMON_ERRORS[FALLBACK_SUFFIX];
  return {
    type: `urn:fathom:problem:${code.toLowerCase()}`,
    title: entry.title,
    status: 500,
    ...(instance === '' ? {} : { instance }),
    code,
    error_id: errorId,
    request_id: ctx.requestId,
    retryable: false,
  };
}

function levelFor(status: number): 'info' | 'warn' | 'error' {
  if (status >= 500) {
    return 'error';
  }
  return status === 401 || status === 403 ? 'warn' : 'info';
}

type Extras = NonNullable<AppError['extra']>;

function sanitizeExtras(extra: Extras | undefined): Record<string, unknown> {
  if (extra === undefined) {
    return {};
  }
  const out: Record<string, unknown> = { ...extra };
  if (extra.errors !== undefined) {
    out.errors = extra.errors.map((e) => ({ ...e, message: isHygienic(e.message) ? e.message : 'invalid' }));
  }
  return out;
}

/** 예상된 `AppError`는 레지스트리의 코드·제목을, 그 밖은 결함 `INTERNAL-900`을 만든다. */
export function toProblem(e: unknown, ctx: ProblemContext): ProblemResult {
  const errorId = ctx.newId();
  const instance = pathOnly(ctx.instance);
  const defect = (logMsg: string): ProblemResult => ({
    status: 500,
    body: minimalBody(ctx, errorId, instance),
    level: 'error',
    errorId,
    logStack: true,
    logMsg,
  });
  if (!(e instanceof AppError)) {
    return defect('unhandled error');
  }
  const entry = ctx.registry[e.code];
  if (entry === undefined || entry.status !== e.status) {
    return defect('invariant: unregistered error code');
  }
  const detail = e.detail !== undefined && isHygienic(e.detail) ? e.detail.slice(0, 1000) : undefined;
  const candidate: Record<string, unknown> = {
    type: `urn:fathom:problem:${e.code.toLowerCase()}`,
    title: entry.title,
    status: e.status,
    ...(detail === undefined ? {} : { detail }),
    instance,
    code: e.code,
    error_id: errorId,
    request_id: ctx.requestId,
    retryable: entry.retryable,
    ...sanitizeExtras(e.extra),
  };
  const parsed = Problem.safeParse(candidate);
  if (!parsed.success) {
    return defect('invariant: problem body violates contract');
  }
  return {
    status: e.status,
    body: parsed.data,
    level: levelFor(e.status),
    errorId,
    logStack: e.status >= 500,
    logMsg: e.code,
  };
}

// ───────── Fastify 오류 → AppError ─────────

function fastifyCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

function fastifyStatus(e: unknown): number | null {
  return typeof e === 'object' && e !== null && 'statusCode' in e && typeof e.statusCode === 'number'
    ? e.statusCode
    : null;
}

/**
 * Fastify가 던지는 본문 오류를 공통 코드로 옮긴다: 413 → `LIMIT-900` · 415 → `VAL-904` · JSON 구문·빈 본문·프로토타입 오염 → `VAL-900`.
 * 이미 `AppError`인 값과 알 수 없는 오류는 그대로 돌려준다.
 */
export function mapFramework(e: unknown, svc: ServiceName): unknown {
  if (e instanceof AppError) {
    return e;
  }
  const code = fastifyCode(e);
  const status = fastifyStatus(e);
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new AppError(appErrorCode(svc, 'LIMIT-900'), 413, '본문이 한도를 넘었다.', { cause: e });
  }
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new AppError(appErrorCode(svc, 'VAL-904'), 415, 'Content-Type은 application/json이어야 한다.', { cause: e });
  }
  if (code?.startsWith('FST_ERR_') === true && status === 400) {
    return new AppError(appErrorCode(svc, 'VAL-900'), 400, '요청 본문을 해석할 수 없다.', {
      cause: e,
      extra: { errors: [{ path: '', message: '본문이 올바른 JSON이 아니다', rule: 'json_syntax' }] },
    });
  }
  if (e instanceof SyntaxError) {
    return new AppError(appErrorCode(svc, 'VAL-900'), 400, '요청 본문을 해석할 수 없다.', { cause: e });
  }
  return e;
}
