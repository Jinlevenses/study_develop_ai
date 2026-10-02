// ported-from: services/gateway/src/domain/session/path.ts (rawPathOf·decodedPathOf·isNonOriginForm·isEncodedBypass·ENCODED_UNRESERVED_RE — 서비스 import 금지라 복사)
// 경로 정규형 검사(NFR-SEC-003, T-01-01 §4.2-1) — 라우터(find-my-way)는 `%XX`를 풀고 절대형 요청 대상(RFC 9112 §3.2.2)도 매칭하지만,
// 인증·분류가 원문 `req.url`의 접두어를 보면 `/%69nternal/…`·`GET http://host/internal/…`이 인증을 건너뛴다. 그래서
//  (1) 요청 분류는 일치한 라우트의 선언 경로로 하고, (2) `/api/`·`/internal/`·health로 해석되는 비정준 대상은 파이프라인 맨 앞에서 404로 거절한다.
// 순수 함수만(STD-ARC-11): `node:*` import 0.

export type RouteClass = 'internal' | 'api' | 'health' | 'other';

const HEALTH_PATHS: ReadonlySet<string> = new Set(['/healthz', '/readyz']);
// RFC 3986 비예약 문자(ALPHA·DIGIT·-._~)의 퍼센트 인코딩 — 정규형에서는 쓰지 않는다.
const ENCODED_UNRESERVED_RE = /%(?:4[1-9A-Fa-f]|5[0-9Aa]|6[1-9A-Fa-f]|7[0-9Aa]|3[0-9]|2[Dd]|2[Ee]|5[Ff]|7[Ee])/;

/** 쿼리(`?`) 앞의 경로부. */
export function rawPathOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

/** 퍼센트 디코딩한 경로부. 잘못된 인코딩이면 `null`(라우터가 400으로 거른다). */
export function decodedPathOf(url: string): string | null {
  try {
    return decodeURIComponent(rawPathOf(url));
  } catch {
    return null;
  }
}

/** 경로(이미 정규형이거나 라우트 선언 경로)의 등급: `/internal/`·`/api/` 접두, `/healthz`·`/readyz` 정확 일치, 그 밖 `other`. */
export function routeClassOf(path: string): RouteClass {
  if (path.startsWith('/internal/')) {
    return 'internal';
  }
  if (path.startsWith('/api/')) {
    return 'api';
  }
  return HEALTH_PATHS.has(path) ? 'health' : 'other';
}

/**
 * 라우트가 일치하지 않은 요청의 등급(cache-control 용) — 디코딩한 경로 기준, 디코딩 불가면 원문 경로.
 * 인증 판정에는 쓰지 않는다(인증은 일치한 라우트의 선언 경로 + 비정준 대상 거절로만 한다).
 */
export function classOfUrl(url: string): RouteClass {
  return routeClassOf(decodedPathOf(url) ?? rawPathOf(url));
}

/**
 * 보호 대상 경로(`/api/`·`/internal/`·health)로 해석되는데 원문이 정규형이 아니거나, 요청 대상이 origin-form이 아니면 true.
 *  ① origin-form이 아님(첫 글자 ≠ '/'): absolute-form `http://host/internal/…`·asterisk-form `*`·빈 값.
 *  ② 디코딩한 경로가 보호 대상인데 원문 경로부가 보호 접두가 아니거나(`/%69nternal/…`·`/internal%2Fv1/…`) 비예약 문자의 `%XX`를 포함(`/internal/v1/%6detrics`).
 *  ③ 그 밖 false — 디코딩 실패(`%zz`)도 false(라우터가 400으로 거른다), 예약 문자 `%3A`·`%2F`가 파라미터 안에 있는 정규형도 false.
 */
export function isNonCanonicalTarget(rawUrl: string): boolean {
  if (!rawUrl.startsWith('/')) {
    return true;
  }
  const raw = rawPathOf(rawUrl);
  const decoded = decodedPathOf(rawUrl);
  if (decoded === null || routeClassOf(decoded) === 'other') {
    return false;
  }
  return routeClassOf(raw) === 'other' || ENCODED_UNRESERVED_RE.test(raw);
}
