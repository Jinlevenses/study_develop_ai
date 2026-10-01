// fixture authored for T-00-05 (no spike counterpart): 사유 있는 boundary-ok 탈출구 3종(비리터럴 import·require·createRequire)
import { createRequire } from "node:module";

const target = "./local.ts";
export async function lazy() {
  // boundary-ok: 플러그인 경로는 실행 시점에 확정되는 같은 서비스 파일뿐이다
  return import(/* @vite-ignore */ target);
}
// boundary-ok: CJS 전용 서드파티 로더(사유 있음)
export const r = createRequire(import.meta.url);
export function legacy(name: string) {
  return r(name); // boundary-ok: 서드파티 로더 이름은 상수 테이블에서만 온다
}
