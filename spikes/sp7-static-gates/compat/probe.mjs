// Probe: which TS-compiler-API based tools work when `typescript` (resolved from cwd) is 7.0.2 vs 5.9.3.
// Usage: cd compat/ts7 && node ../probe.mjs     |     cd compat/ts5 && node ../probe.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const cwd = process.cwd();
const req = createRequire(path.join(cwd, "noop.js"));
const FIXTURE = path.resolve(cwd, "../../fixture/clean");
const out = { cwd: path.basename(cwd), node: process.version, results: {} };
const rec = (k, ok, detail) => { out.results[k] = { ok, detail: String(detail).split("\n")[0].slice(0, 220) }; };

// 1. compiler API surface
try {
  const ts = req("typescript");
  rec("typescript.version", true, ts.version ?? ts.default?.version);
  rec("typescript.createProgram()", typeof ts.createProgram === "function", typeof ts.createProgram === "function" ? "present" : `missing; exports = ${Object.keys(ts).join(",")}`);
} catch (e) { rec("typescript.require", false, e.message); }

// 1b. side-by-side layout: which binary does `tsc` resolve to, and is TS 7 still reachable?
try {
  const { spawnSync } = await import("node:child_process");
  const bin = spawnSync(process.execPath, [path.join(cwd, "node_modules/.bin/tsc"), "-v"], { encoding: "utf8" }).stdout.trim();
  rec("node_modules/.bin/tsc -v", true, bin);
  const p7 = path.join(cwd, "node_modules/typescript7/bin/tsc");
  const { existsSync } = await import("node:fs");
  if (existsSync(p7)) rec("typescript7 alias: tsc -v", true, spawnSync(process.execPath, [p7, "-v"], { encoding: "utf8" }).stdout.trim());
} catch (e) { rec("tsc bin", false, e.message); }

// 2. typescript-eslint (syntactic parse + a rule; then type-aware via projectService)
try {
  const { ESLint } = await import(pathToFileURL(path.join(cwd, "node_modules/eslint/lib/api.js")).href);
  const tseslint = (await import(pathToFileURL(req.resolve("typescript-eslint")).href)).default;
  const base = { cwd: FIXTURE, overrideConfigFile: true, overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, plugins: { "@typescript-eslint": tseslint.plugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } },
  ] };
  const eslint = new ESLint(base);
  const res = await eslint.lintFiles(["services/a/src/index.ts"]);
  rec("typescript-eslint (syntactic)", true, `parsed, messages=${res[0].messages.length}, fatal=${res[0].messages.filter((m) => m.fatal).length}`);
  const eslint2 = new ESLint({ cwd: FIXTURE, overrideConfigFile: true, overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: FIXTURE } }, plugins: { "@typescript-eslint": tseslint.plugin }, rules: { "@typescript-eslint/no-floating-promises": "error" } },
  ] });
  const res2 = await eslint2.lintFiles(["services/a/src/index.ts"]);
  rec("typescript-eslint (type-aware, projectService)", !res2[0].messages.some((m) => m.fatal), res2[0].messages.map((m) => m.message).join(" | ") || "ok, 0 messages");
} catch (e) { rec("typescript-eslint", false, e.message); }

// 3. ts-morph (bundles its own TS via @ts-morph/common)
try {
  const { Project } = await import(pathToFileURL(req.resolve("ts-morph")).href);
  const project = new Project({ tsConfigFilePath: path.join(FIXTURE, "tsconfig.json") });
  const specs = project.getSourceFiles().flatMap((f) => f.getImportDeclarations().map((d) => d.getModuleSpecifierValue()));
  const diags = project.getPreEmitDiagnostics().length;
  rec("ts-morph", true, `files=${project.getSourceFiles().length} imports=${specs.length} diagnostics=${diags}`);
} catch (e) { rec("ts-morph", false, e.message); }

// 4. dependency-cruiser (TS-aware boundary rules)
try {
  const dc = await import(pathToFileURL(path.join(cwd, "node_modules/dependency-cruiser/src/main/index.mjs")).href);
  const ruleSet = { forbidden: [{ name: "no-cross-service", severity: "error", from: { path: "^services/([^/]+)/" }, to: { path: "^services/([^/]+)/", pathNot: "^services/$1/" } }], options: { tsConfig: { fileName: path.join(FIXTURE, "tsconfig.json") }, tsPreCompilationDeps: true } };
  const r = await dc.cruise(["services"], ruleSet.options && { ...ruleSet.options, ruleSet, baseDir: FIXTURE, validate: true });
  rec("dependency-cruiser (clean fixture)", true, `modules=${r.output.modules.length} violations=${r.output.summary.violations.length}`);
  const rv = await dc.cruise(["services"], { ...ruleSet.options, ruleSet, baseDir: path.resolve(cwd, "../../fixture/violations"), validate: true });
  rec("dependency-cruiser (violations fixture)", true, `modules=${rv.output.modules.length} violations=${rv.output.summary.violations.length}`);
} catch (e) { rec("dependency-cruiser", false, e.message); }

console.log(JSON.stringify(out, null, 2));
