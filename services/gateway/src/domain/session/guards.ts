// IF-01 §2.11 검사 규칙 — Host(421) · Origin·Sec-Fetch-Site(403) · 클라이언트 버전(409). 순수 함수만(PGM-GW-006).

/** 소문자화 후 ∈ {'127.0.0.1:<port>', 'localhost:<port>'}. */
export function checkHost(host: string | undefined, port: number): boolean {
  if (host === undefined) {
    return false;
  }
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/** 정확히 ∈ {'http://127.0.0.1:<port>', 'http://localhost:<port>'} (없음 = false). */
export function checkOrigin(origin: string | undefined, port: number): boolean {
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** 없음 = true, 있으면 ∈ {'same-origin', 'none'}. */
export function checkSecFetchSite(v: string | undefined): boolean {
  return v === undefined || v === 'same-origin' || v === 'none';
}

/** GET·HEAD·OPTIONS 외 = 상태 변경. */
export function isStateChanging(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

const CLIENT_RE = /^(web|cli)\/(.+)$/;

/** 없음 = 통과 [Brief 결정], 있으면 `(web|cli)/<버전>`의 버전이 app_version과 같아야 한다. */
export function checkClientVersion(header: string | undefined, appVersion: string): boolean {
  if (header === undefined) {
    return true;
  }
  const m = CLIENT_RE.exec(header);
  return m !== null && m[2] === appVersion;
}
