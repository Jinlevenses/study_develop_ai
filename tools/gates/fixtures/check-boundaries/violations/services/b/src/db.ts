// ported-from: spikes/sp7-static-gates/fixture/violations/services/b/src/db.ts (audit-fixed: sqlite-direct 마커 추가)
import { DatabaseSync } from "node:sqlite"; // EXPECT[boundary/sqlite-direct]
import { join } from "node:path";
import { LOCAL } from "@fathom/svc-a/local.ts"; // EXPECT[boundary/cross-service-import]

// NFR-MAINT-002: another service's data file must never be opened.
export function stealA(): DatabaseSync {
  return new DatabaseSync(join(import.meta.dirname, "..", "..", "a", "data", "a.sqlite")); // EXPECT[boundary/db-path] EXPECT[boundary/sqlite-direct]
}
export function stealA2(): DatabaseSync {
  return new DatabaseSync("services/a/data/a.sqlite"); // EXPECT[boundary/db-path] EXPECT[boundary/sqlite-direct]
}
export const N = LOCAL;
