// §4.4 경로 변환 — contracts 표기 → Fastify 표기. 리터럴 `:`(콜론 동사)는 `::`로 이스케이프한 뒤 `{name}` → `:name`.
export function toFastifyPath(path: string): string {
  return path.replaceAll(':', '::').replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ':$1');
}
