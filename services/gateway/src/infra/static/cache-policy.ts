// IF §2.2 `cache-control` 행 — 해시가 붙은 정적 자산은 immutable, 그 밖(index.html·sw.js·manifest 포함)은 매번 재검증한다.

const HASHED_ASSET_RE = /^assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2|svg|png|webp|ico|json)$/;

export function cachePolicy(rel: string): string {
  return HASHED_ASSET_RE.test(rel) ? 'public, max-age=31536000, immutable' : 'no-cache';
}
