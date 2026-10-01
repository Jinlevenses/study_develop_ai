// fixture authored for T-00-05 (no spike counterpart): 허용 위치(sk-pure 위반의 대상)
import { DatabaseSync } from "node:sqlite";

export function openDb(path: string): DatabaseSync {
  return new DatabaseSync(path);
}
