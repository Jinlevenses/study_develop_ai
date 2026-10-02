// 경로 정규화 검사 — 라우터(find-my-way)는 `%XX`를 풀고 매칭하지만 인증 단계는 원본 `req.url`의 접두사를 본다.
// 둘이 어긋나면 `/%61pi/…`가 인증 없이 통과한다. 그래서 `/api/`·`/internal/` 요청은 "정규형"(비예약 문자를 퍼센트 인코딩하지 않음)만 받는다.
// 요청 대상이 origin-form(`/…`)이 아닌 경우(absolute-form `http://host/api/…`, asterisk-form `*`)도 같은 어긋남이 생긴다 —
// Node는 `req.url`을 그대로 두는데 라우터는 `/api/…`로 매칭한다(RFC 9112 §3.2.2). 이 서비스는 origin-form만 받는다.
// 순수 함수만(STD-ARC-11).

const GUARDED_PREFIXES: readonly string[] = ['/api/', '/internal/'];
// RFC 3986 비예약 문자(ALPHA·DIGIT·-._~)의 퍼센트 인코딩 — 정규형에서는 쓰지 않는다.
const ENCODED_UNRESERVED_RE = /%(?:4[1-9A-Fa-f]|5[0-9Aa]|6[1-9A-Fa-f]|7[0-9Aa]|3[0-9]|2[Dd]|2[Ee]|5[Ff]|7[Ee])/;

export function rawPathOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

/** 퍼센트 디코딩한 경로. 잘못된 인코딩이면 `null`(라우터가 400으로 거른다). */
export function decodedPathOf(url: string): string | null {
  try {
    return decodeURIComponent(rawPathOf(url));
  } catch {
    return null;
  }
}

function isGuarded(path: string): boolean {
  return GUARDED_PREFIXES.some((p) => path.startsWith(p));
}

/** 인증 분류용 경로 — 디코딩한 경로(디코딩 불가면 원본). */
export function classifyPathOf(url: string): string {
  return decodedPathOf(url) ?? rawPathOf(url);
}

/** `/api/`·`/internal/` 경로(디코딩 기준)인가. */
export function isGuardedPath(url: string): boolean {
  return isGuarded(classifyPathOf(url));
}

/** 요청 대상이 origin-form(`/`로 시작)이 아니다 — absolute-form·asterisk-form·빈 값. */
export function isNonOriginForm(url: string): boolean {
  return !url.startsWith('/');
}

/**
 * 인증 접두사 분류를 우회하려는 요청이면 true.
 * (1) origin-form이 아닌 대상(`http://127.0.0.1:4747/api/…`) — 라우터는 경로만 보고 매칭하지만 원본 접두사는 `/api/`가 아니다.
 * (2) 디코딩하면 `/api/`·`/internal/`인데 원본이 정규형이 아닌 경우 — 접두사 또는 비예약 문자를 퍼센트 인코딩(`/%61pi/…`, `/api%2Fv1/…`).
 */
export function isEncodedBypass(url: string): boolean {
  if (isNonOriginForm(url)) {
    return true;
  }
  const raw = rawPathOf(url);
  const decoded = decodedPathOf(url);
  if (decoded === null || !isGuarded(decoded)) {
    return false;
  }
  return !isGuarded(raw) || ENCODED_UNRESERVED_RE.test(raw);
}
