import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { LOCAL } from "@fathom/svc-a/store.ts"; // EXPECT[boundary/cross-service-import]

// NFR-MAINT-002: another service's data file must never be opened.
export function stealA(): DatabaseSync {
  return new DatabaseSync(join(import.meta.dirname, "..", "..", "a", "data", "a.sqlite")); // EXPECT[boundary/db-path]
}
export function stealA2(): DatabaseSync {
  return new DatabaseSync("services/a/data/a.sqlite"); // EXPECT[boundary/db-path]
}
export const N = LOCAL;
