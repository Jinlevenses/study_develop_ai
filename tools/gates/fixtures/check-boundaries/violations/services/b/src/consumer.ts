// ported-from: spikes/sp7-static-gates/fixture/violations/services/b/src/consumer.ts (audit-fixed: sqlite-direct 마커 추가)
import { DatabaseSync } from "node:sqlite"; // EXPECT[boundary/sqlite-direct]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemResultPostSubmit } from "@fathom/contracts";

// Own data only: b's DB lives under b's own directory (no db-path), but src must not open it directly.
export function openOwn(): DatabaseSync {
  return new DatabaseSync(join(import.meta.dirname, "..", "data", "b.sqlite")); // EXPECT[boundary/sqlite-direct]
}
export function readLocal(): string {
  return readFileSync(join(import.meta.dirname, "..", "README.txt"), "utf8") + String(ItemResultPostSubmit);
}
