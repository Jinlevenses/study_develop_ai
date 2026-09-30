// Known evasions of check:boundaries: real boundary violations that a static gate cannot (or does not) see.
import { createRequire } from "node:module";

const target = "../../b/src/local.ts";
export async function nonLiteral() {
  return import(/* @vite-ignore */ target); // EVADES[boundary/cross-service-import] non-literal dynamic import (tokens: warn only)
}
export const U = new URL("../../b/src/local.ts", import.meta.url); // EVADES[boundary/cross-service-import] path reference, not an import
export const R = createRequire(import.meta.url)("../../b/src/local.ts"); // EVADES[boundary/cross-service-import] require through createRequire()
export type T = typeof import("../../b/src/local.ts"); // DETECTS[boundary/cross-service-import] type-position import()
