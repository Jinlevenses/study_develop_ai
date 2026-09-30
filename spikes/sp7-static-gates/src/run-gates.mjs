#!/usr/bin/env node
// check:all -- run the four static gates against --root and exit non-zero if any fails (CI entry point, INT-1a "게이트").
// boundaries uses tokens+tsgo (union) when <root>/tsconfig.json exists (module resolution by the compiler), else the token engine.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { root } = parseArgs();
const engine = existsSync(path.join(root, "tsconfig.json")) ? "both" : "tokens";
const gates = [
  ["check:boundaries", "check-boundaries.mjs", [`--engine=${engine}`]],
  ["check:jev-index", "check-jev-index.mjs", []],
  ["check:sql", "check-sql-template.mjs", []],
  ["check:ng-g", "check-ng-g.mjs", []],
];
let failed = 0;
for (const [name, script, extra] of gates) {
  const r = spawnSync("node", [path.join(HERE, script), "--root", root, "--quiet", "--json", ...extra], { encoding: "utf8" });
  let errors = "?"; try { errors = JSON.parse(r.stdout.trim().split("\n").pop()).errors; } catch { /* keep ? */ }
  console.log(`${r.status === 0 ? "PASS" : "FAIL"}  ${name.padEnd(18)} errors=${errors}${r.status !== 0 && r.status !== 1 ? `  (crashed: ${r.stderr.split("\n")[0]})` : ""}`);
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
