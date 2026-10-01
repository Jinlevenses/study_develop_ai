// fixture authored for T-00-05 (no spike counterpart): nonliteral-import·require·create-require, 사유 없는 boundary-ok 는 무효
import { createRequire } from "node:module";

const target = "./local.ts";
export async function dyn() {
  return import(/* @vite-ignore */ target); // EXPECT[boundary/nonliteral-import]
}
export async function noReason() {
  // boundary-ok:
  return import(target); // EXPECT[boundary/nonliteral-import]
}
export function req(name: string) {
  const fs = require("node:fs"); // EXPECT[boundary/require]
  return [fs, require(name)]; // EXPECT[boundary/nonliteral-import]
}
export const r = createRequire(import.meta.url); // EXPECT[boundary/create-require]
