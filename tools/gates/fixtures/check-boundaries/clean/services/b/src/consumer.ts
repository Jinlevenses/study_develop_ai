// ported-from: spikes/sp7-static-gates/fixture/violations/services/b/src/consumer.ts (audit-fixed: node:sqlite 직접 사용 제거(sqlite-direct))
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemResultPostSubmit } from "@fathom/contracts";

export function readLocal(): string {
  return readFileSync(join(import.meta.dirname, "..", "README.txt"), "utf8") + String(ItemResultPostSubmit);
}
