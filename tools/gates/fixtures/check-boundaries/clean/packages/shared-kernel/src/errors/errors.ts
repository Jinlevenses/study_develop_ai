// fixture authored for T-00-05 (no spike counterpart): sk-pure 정상: 같은 모듈 디렉터리 안만 import
import { Err } from "./kinds.ts";

export function fail(msg: string): Err {
  return new Err(msg);
}
