import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemResultPostSubmit } from "@fathom/contracts";

// Own data only: b's DB lives under b's own directory.
export function openOwn(): DatabaseSync {
  return new DatabaseSync(join(import.meta.dirname, "..", "data", "b.sqlite"));
}
export function readLocal(): string {
  return readFileSync(join(import.meta.dirname, "..", "README.txt"), "utf8") + String(ItemResultPostSubmit);
}
