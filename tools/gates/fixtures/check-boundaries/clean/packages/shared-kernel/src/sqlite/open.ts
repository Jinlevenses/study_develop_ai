// fixture authored for T-00-05 (no spike counterpart): node:sqlite·new DatabaseSync 허용 위치(intra.sqlite_direct.allow)
import { DatabaseSync } from "node:sqlite";

export function openDb(path: string): DatabaseSync {
  return new DatabaseSync(path);
}
