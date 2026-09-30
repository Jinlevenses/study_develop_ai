#!/usr/bin/env node
// SP-7 full measurement: runs every gate on fixture/clean (must exit 0), fixture/violations (must exit non-zero),
// scores each engine against the // EXPECT[rule] markers, probes evasions, tsc 7, Biome, graphify, tool compatibility and scale.
// Prints one JSON summary to stdout (progress -> stderr) and writes results/summary.json.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExpectations, walk } from "./lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FX = (n) => path.join(ROOT, "fixture", n);
const BIN = (n) => path.join(ROOT, "node_modules", ".bin", n);
const log = (...a) => console.error("[sp7]", ...a);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (x) => Math.round(x * 10) / 10;

function sh(cmd, args, opts = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: performance.now() - t0 };
}

// ------------------------------------------------------------------ environment
const env = {
  node: process.version,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  cpus: os.cpus().length,
  tsc: sh(BIN("tsc"), ["-v"]).stdout.trim(),
  biome: sh(BIN("biome"), ["--version"]).stdout.trim(),
  graphify: sh("graphify", ["--version"]).stdout.trim() || sh("graphify", ["--help"]).stdout.split("\n")[0],
  esModuleLexer: JSON.parse(readFileSync(path.join(ROOT, "node_modules/es-module-lexer/package.json"), "utf8")).version,
  typescriptPkg: JSON.parse(readFileSync(path.join(ROOT, "node_modules/typescript/package.json"), "utf8")).version,
};
log("env", JSON.stringify(env));

// ------------------------------------------------------------------ scoring
const family = (rule) => (rule.startsWith("boundary/") ? "boundary" : rule.startsWith("jev/") ? "jev" : rule.startsWith("sql/") ? "sql" : /^(ng-g|design)/.test(rule) ? "ng" : rule.split("/")[0]);
const PREFIX = { boundary: ["boundary/"], jev: ["jev/"], sql: ["sql/"], ng: ["ng-g", "design/"] };

function expectedFor(root, fam, mode) {
  const files = walk(root, null).filter((f) => /\.(ts|tsx|css|md|json)$/.test(f) && !f.includes("node_modules"));
  const set = loadExpectations(root, files, PREFIX[fam]);
  if (mode === "line") return new Set([...set].map((k) => k.split(":").slice(0, 2).join(":")));
  return set;
}
function score(violations, root, fam, mode = "rule") {
  const exp = expectedFor(root, fam, mode);
  const keyOf = (v) => (mode === "line" ? `${v.file}:${v.line}` : `${v.file}:${v.line}:${v.rule}`);
  const got = new Set(violations.filter((v) => family(v.rule) === fam).map(keyOf));
  const tp = [...got].filter((k) => exp.has(k)).length;
  return {
    mode, expected: exp.size, reported: got.size, tp,
    fp: [...got].filter((k) => !exp.has(k)), fn: [...exp].filter((k) => !got.has(k)),
    precision: got.size ? r1((tp / got.size) * 1000) / 1000 : 1, recall: exp.size ? r1((tp / exp.size) * 1000) / 1000 : 1,
  };
}

// ------------------------------------------------------------------ run one of our checkers
function runChecker(script, root, extra = [], repeat = 1) {
  const times = []; let last;
  for (let i = 0; i < repeat; i++) { last = sh("node", [path.join(HERE, script), "--root", root, "--json", ...extra]); times.push(last.ms); }
  let parsed = null;
  try { parsed = JSON.parse(last.stdout.trim().split("\n").pop()); } catch { /* not json */ }
  return { exit: last.status, ms: r1(median(times)), parsed, stderr: last.stderr.slice(0, 300) };
}

function evalChecker(name, script, fam, extra = [], opts = {}) {
  const repeat = opts.repeat ?? 3;
  const v = runChecker(script, FX("violations"), extra, repeat);
  const c = runChecker(script, FX("clean"), extra, repeat);
  const viol = v.parsed?.violations ?? [];
  const res = {
    engine: name,
    exit_violations: v.exit, exit_clean: c.exit,
    gate_ok: v.exit !== 0 && c.exit === 0,
    ms_violations: v.ms, ms_clean: c.ms,
    errors_violations: v.parsed?.errors, warnings_violations: v.parsed?.warnings, errors_clean: c.parsed?.errors,
    score_rule: score(viol, FX("violations"), fam, "rule"),
    score_line: score(viol, FX("violations"), fam, "line"),
    clean_false_positives: (c.parsed?.violations ?? []).map((x) => `${x.file}:${x.line}:${x.rule}`),
  };
  log(name, "gate_ok", res.gate_ok, "recall(rule)", res.score_rule.recall, "precision(rule)", res.score_rule.precision, `${res.ms_violations}ms`);
  return res;
}

// ------------------------------------------------------------------ Biome (Grit plugins / noRestrictedImports)
function runBiome(rootName, configDir, extra = []) {
  const cwd = FX(rootName);
  const args = ["lint", "--reporter=json", "--colors=off", "--max-diagnostics=2000", ...(configDir ? [`--config-path=${configDir}`] : []), ...extra, "."];
  const r = sh(BIN("biome"), args, { cwd });
  let d = null; try { d = JSON.parse(r.stdout); } catch { /* */ }
  const violations = (d?.diagnostics ?? [])
    .filter((x) => x.severity === "error" && x.location?.path)
    .map((x) => ({ file: x.location.path, line: x.location.start.line, rule: /^[a-z0-9-]+\/[A-Za-z0-9*|-]+:/.test(x.message) ? x.message.split(":")[0].split("|")[0].replace("*", "x") : x.category === "lint/style/noRestrictedImports" ? "boundary/cross-service-import" : `biome/${x.category}`, message: x.message }));
  return { exit: r.status, ms: r.ms, violations, biomeDurationMs: d ? Math.round(d.summary.duration / 1e6) : null, raw: d?.summary };
}
function evalBiome(name, fam, configDir, repeat = 3, cleanConfigDir = configDir) {
  const times = []; let v; for (let i = 0; i < repeat; i++) { v = runBiome("violations", configDir); times.push(v.ms); }
  const c = runBiome("clean", cleanConfigDir);
  const res = {
    engine: name, exit_violations: v.exit, exit_clean: c.exit, gate_ok: v.exit !== 0 && c.exit === 0,
    ms_violations: r1(median(times)), errors_violations: v.violations.length, errors_clean: c.violations.length,
    score_line: score(v.violations, FX("violations"), fam, "line"),
    score_rule: score(v.violations, FX("violations"), fam, "rule"),
    clean_false_positives: c.violations.map((x) => `${x.file}:${x.line}:${x.rule}`),
  };
  log(name, "gate_ok", res.gate_ok, "recall(line)", res.score_line.recall, "precision(line)", res.score_line.precision, `${res.ms_violations}ms`);
  return res;
}
function writeTmpBiomeConfig(obj) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sp7-biome-"));
  writeFileSync(path.join(dir, "biome.json"), JSON.stringify(obj, null, 2));
  return dir;
}
const P = (n) => path.join(ROOT, "biome-plugins", n);
const gritCfg = (plugins) => writeTmpBiomeConfig({ root: true, vcs: { enabled: false }, formatter: { enabled: false }, linter: { enabled: true, rules: { preset: "none" } }, plugins });

// ------------------------------------------------------------------ tsc / TS 7 API
function typecheckSection() {
  const out = { tsc: env.tsc, projects: {} };
  for (const n of ["clean", "violations", "evasions"]) {
    const r = sh(BIN("tsc"), ["-p", path.join(FX(n), "tsconfig.json")]);
    out.projects[n] = { exit: r.status, ms: r1(r.ms), diagnostics: r.stdout.split("\n").filter((l) => /error TS/.test(l)).length };
  }
  // negative control: prove tsc 7 really reports errors on this fixture layout
  const tmp = mkdtempSync(path.join(os.tmpdir(), "sp7-tscneg-"));
  cpSync(FX("clean"), path.join(tmp, "fx"), { recursive: true });
  writeFileSync(path.join(tmp, "fx/services/a/src/broken.ts"), 'export const x: number = "not a number";\n');
  // resolve node_modules from the spike dir
  const link = sh("ln", ["-s", path.join(ROOT, "node_modules"), path.join(tmp, "node_modules")]);
  const neg = sh(BIN("tsc"), ["-p", path.join(tmp, "fx/tsconfig.json")]);
  out.negative_control = { exit: neg.status, first_error: (neg.stdout.split("\n").find((l) => /error TS/.test(l)) ?? "").slice(0, 160), ln_status: link.status };
  rmSync(tmp, { recursive: true, force: true });
  // API surface
  const api = sh("node", ["-e", "const ts=require('typescript');console.log(JSON.stringify({keys:Object.keys(ts),createProgram:typeof ts.createProgram}))"], { cwd: ROOT });
  out.require_typescript = JSON.parse(api.stdout);
  const t0 = performance.now();
  const probe = sh("node", ["-e", `
    import('typescript/unstable/sync').then(async ({API}) => {
      const path = await import('node:path'); const root = ${JSON.stringify(FX("violations"))};
      const t0 = performance.now(); const api = new API({cwd: root});
      const s = api.updateSnapshot({openProjects:[path.join(root,'tsconfig.json')]}); const p = s.getProjects()[0];
      const openMs = performance.now() - t0; const files = p.program.getSourceFileNames().filter(f=>!f.includes('node_modules')).length;
      const t1 = performance.now(); const d = p.program.getSemanticDiagnostics().length; const semMs = performance.now() - t1;
      api.close(); console.log(JSON.stringify({openMs, files, semanticDiagnostics: d, semMs}));
    }).catch(e => { console.log(JSON.stringify({error: String(e.message)})); });
  `], { cwd: ROOT });
  try { out.unstable_sync_api = JSON.parse(probe.stdout.trim().split("\n").pop()); } catch { out.unstable_sync_api = { error: probe.stderr.slice(0, 200) }; }
  out.unstable_sync_api.wall_ms = r1(performance.now() - t0);
  return out;
}

// ------------------------------------------------------------------ evasion matrix
function evasionMatrix() {
  const root = FX("evasions");
  const files = walk(root, null).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("node_modules"));
  const marks = [];
  for (const f of files) readFileSync(path.join(root, f), "utf8").split("\n").forEach((l, i) => {
    const m = /(EVADES|DETECTS)\[([^\]]+)\]\s*(.*)$/.exec(l);
    if (m) marks.push({ file: f, line: i + 1, kind: m[1], rule: m[2], note: m[3].trim() });
    else if (/SAFE:/.test(l)) marks.push({ file: f, line: i + 1, kind: "SAFE", rule: "*", note: l.split("SAFE:")[1].trim() });
  });
  const engines = {
    tokens: () => ["check-boundaries.mjs", "check-sql-template.mjs", "check-jev-index.mjs", "check-ng-g.mjs"].flatMap((s) => runChecker(s, root).parsed?.violations ?? []),
    tsgo: () => [...(runChecker("check-boundaries.mjs", root, ["--engine=tsgo"]).parsed?.violations ?? []), ...(runChecker("check-sql-typed.mjs", root).parsed?.violations ?? [])],
    grit: () => runBiome("evasions", gritCfg([P("boundaries.grit"), P("sql-template.grit"), { path: P("jev-index.grit"), includes: ["**/jev/**", "**/*.jev.*"] }, { path: P("ng-g-ts.grit"), includes: ["**/*.ts", "**/*.tsx", "!**/design-tokens/**"] }, { path: P("ng-g3-presubmit-named.grit"), includes: ["**/*.ts"] }])).violations,
  };
  const reports = Object.fromEntries(Object.entries(engines).map(([k, f]) => [k, f()]));
  const rows = marks.map((m) => {
    const row = { where: `${m.file}:${m.line}`, kind: m.kind, rule: m.rule, note: m.note };
    for (const [k, vs] of Object.entries(reports)) {
      if (k === "tsgo" && m.kind !== "SAFE" && !["boundary", "sql"].includes(family(m.rule))) { row[k] = "n/a"; continue; }
      const hit = vs.some((v) => v.file === m.file && v.line === m.line && (m.rule === "*" || family(v.rule) === family(m.rule)));
      const warn = k === "tokens" && vs.some((v) => v.file === m.file && v.line === m.line && v.level === "warn");
      row[k] = hit ? "flagged" : "silent";
      if (warn) row[k] = "warn-only";
    }
    return row;
  });
  return rows;
}

// ------------------------------------------------------------------ compat probes (results written by compat/*/probe)
function compatSection() {
  const out = {};
  for (const d of ["ts7", "ts7-swc", "ts5", "ts7-sbs"]) {
    const dir = path.join(ROOT, "compat", d);
    if (!existsSync(path.join(dir, "node_modules"))) { out[d] = "not installed (run: npm run compat:install)"; continue; }
    const r = sh("node", ["../probe.mjs"], { cwd: dir });
    try { out[d] = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).results; } catch { out[d] = { error: (r.stderr || r.stdout).slice(0, 300) }; }
  }
  const more = path.join(ROOT, "compat", "ts7-more");
  if (existsSync(path.join(more, "node_modules"))) {
    const r = sh("node", ["probe-more.mjs"], { cwd: more });
    try { out["ts7-more"] = JSON.parse(r.stdout); } catch { out["ts7-more"] = { error: (r.stderr || r.stdout).slice(0, 300) }; }
  } else out["ts7-more"] = "not installed (run: npm run compat:install)";
  return out;
}

// ------------------------------------------------------------------ scale
function scaleSection() {
  const N = Number(process.env.SP7_SCALE ?? 100);
  const dir = path.join(ROOT, ".work", "scale");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(FX("clean"), dir, { recursive: true });
  for (let i = 0; i < N; i++) {
    const dst = path.join(dir, "services", `s${i}`);
    cpSync(path.join(FX("clean"), "services/a"), dst, { recursive: true });
  }
  const tsFiles = walk(dir, new Set([".ts", ".tsx"])).length;
  const res = { files_ts: tsFiles, services: N + 2 };
  const time = (label, fn, repeat = 3) => { const ts = []; let last; for (let i = 0; i < repeat; i++) { const t = performance.now(); last = fn(); ts.push(performance.now() - t); } res[label] = { median_ms: r1(median(ts)), exit: last?.exit ?? last?.status }; };
  time("boundaries_tokens", () => runChecker("check-boundaries.mjs", dir));
  time("boundaries_lexer", () => runChecker("check-boundaries.mjs", dir, ["--engine=lexer"]));
  time("boundaries_tsgo", () => runChecker("check-boundaries.mjs", dir, ["--engine=tsgo"]), 2);
  time("jev_index_tokens", () => runChecker("check-jev-index.mjs", dir));
  time("sql_tokens", () => runChecker("check-sql-template.mjs", dir));
  time("ng_g_tokens", () => runChecker("check-ng-g.mjs", dir));
  time("tsc7_typecheck", () => sh(BIN("tsc"), ["-p", path.join(dir, "tsconfig.json")]), 2);
  const gritScale = gritCfg([P("boundaries.grit"), P("sql-template.grit"), { path: P("jev-index.grit"), includes: ["**/jev/**"] }, { path: P("ng-g-ts.grit"), includes: ["**/*.ts", "**/*.tsx", "!**/design-tokens/**"] }, { path: P("ng-g-css.grit"), includes: ["**/*.css", "!**/design-tokens/**"] }]);
  time("biome_grit_all_plugins", () => sh(BIN("biome"), ["lint", "--colors=off", `--config-path=${gritScale}`, "."], { cwd: dir }), 3);
  const gg = sh("graphify", ["extract", dir, "--code-only", "--no-cluster", "--force", "--out", path.join(dir, "..", "scale-graphify")]);
  res.graphify_extract = { ms: r1(gg.ms), exit: gg.status };
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.join(ROOT, ".work", "scale-graphify"), { recursive: true, force: true });
  return res;
}

// ================================================================== main
const summary = { env, generated: new Date().toISOString() };

log("typecheck");
summary.typecheck = typecheckSection();

log("boundaries");
const nri = (patterns) => ({ linter: { rules: { style: { noRestrictedImports: { level: "error", options: { patterns } } } } } });
const restricted = writeTmpBiomeConfig({
  root: true, vcs: { enabled: false }, formatter: { enabled: false },
  linter: { enabled: true, rules: { preset: "none" } },
  overrides: [
    ...["a", "b"].map((me) => ({
      includes: [`**/services/${me}/**`],
      ...nri([
        { group: ["@fathom/svc-*", "@fathom/svc-*/**", `!@fathom/svc-${me}`, `!@fathom/svc-${me}/**`], message: "boundary/cross-service-import" },
        // relative imports cannot be resolved by Biome: deny anything that climbs >= 2 levels into a sibling dir (depth-dependent, heuristic)
        { group: ["../../*/**", "../../../*/**", "../../../../*/**", "!../../store.ts"], message: "boundary/cross-service-import" },
      ]),
    })),
    { includes: ["**/apps/**", "**/packages/**"], ...nri([{ group: ["@fathom/svc-*", "@fathom/svc-*/**", "**/services/**"], message: "boundary/cross-service-import" }]) },
  ],
});
summary.boundaries = {
  tokens: evalChecker("boundaries/tokens", "check-boundaries.mjs", "boundary", ["--engine=tokens"]),
  lexer: evalChecker("boundaries/es-module-lexer", "check-boundaries.mjs", "boundary", ["--engine=lexer"]),
  regex: evalChecker("boundaries/regex", "check-boundaries.mjs", "boundary", ["--engine=regex"]),
  tsgo: evalChecker("boundaries/tsgo-api", "check-boundaries.mjs", "boundary", ["--engine=tsgo"], { repeat: 3 }),
  both: evalChecker("boundaries/tokens+tsgo", "check-boundaries.mjs", "boundary", ["--engine=both"], { repeat: 3 }),
  biome_grit: evalBiome("boundaries/biome-grit", "boundary", gritCfg([P("boundaries.grit")])),
  biome_noRestrictedImports: evalBiome("boundaries/biome-noRestrictedImports", "boundary", restricted),
};
// graphify (file-level scoring: the graph collapses parallel edges, so line numbers are not comparable)
{
  const v = runChecker("check-graphify-edges.mjs", FX("violations"));
  const c = runChecker("check-graphify-edges.mjs", FX("clean"));
  const files = [...new Set((v.parsed?.violations ?? []).map((x) => x.file))].sort();
  const exp = [...new Set([...expectedFor(FX("violations"), "boundary", "rule")].filter((k) => k.endsWith("boundary/cross-service-import")).map((k) => k.split(":")[0]))].sort();
  summary.boundaries.graphify = {
    engine: "boundaries/graphify-edges", exit_violations: v.exit, exit_clean: c.exit, gate_ok: v.exit !== 0 && c.exit === 0,
    ms_including_graphify_extract_violations: v.ms, ms_including_graphify_extract_clean: c.ms, graph: { nodes: v.parsed?.graphNodes, edges: v.parsed?.graphEdges },
    file_level: { expected_files: exp, flagged_files: files, missed: exp.filter((f) => !files.includes(f)), extra: files.filter((f) => !exp.includes(f)) },
    clean_false_positives: (c.parsed?.violations ?? []).length,
  };
  log("graphify gate_ok", summary.boundaries.graphify.gate_ok, JSON.stringify(summary.boundaries.graphify.file_level.missed));
}

log("jev-index");
summary.jev_index = {
  tokens: evalChecker("jev/tokens", "check-jev-index.mjs", "jev"),
  biome_grit: evalBiome("jev/biome-grit", "jev", gritCfg([{ path: P("jev-index.grit"), includes: ["**/jev/**", "**/*.jev.*"] }])),
};

log("sql");
summary.sql_template = {
  tokens: evalChecker("sql/tokens", "check-sql-template.mjs", "sql"),
  tsgo_typed: evalChecker("sql/tsgo-typed", "check-sql-typed.mjs", "sql"),
  biome_grit: evalBiome("sql/biome-grit", "sql", gritCfg([P("sql-template.grit")])),
};

log("ng-g");
const nggPlugins = [
  { path: P("ng-g-ts.grit"), includes: ["**/*.ts", "**/*.tsx", "!**/design-tokens/**"] },
  { path: P("ng-g-css.grit"), includes: ["**/*.css", "!**/design-tokens/**"] },
  { path: P("ng-g3-presubmit.grit"), includes: ["**/pre-submit/**"] },
  { path: P("ng-g3-presubmit-named.grit"), includes: ["**/*.ts"] },
  { path: P("ng-g4-routing.grit"), includes: ["**/routing/**", "**/router/**"] },
  { path: P("ng-g6-contracts.grit"), includes: ["**/packages/contracts/**"] },
  { path: P("ng-g7-blank-note.grit"), includes: ["**/blank-note/**", "!**/post-submit/**"] },
];
summary.ng_g = {
  tokens: evalChecker("ng-g/tokens", "check-ng-g.mjs", "ng"),
  biome_grit: evalBiome("ng-g/biome-grit", "ng", gritCfg(nggPlugins)),
};

log("all-in-one biome config shipped in fixture (biome.json, relative plugin paths)");
{
  const v = runBiome("violations", null); const c = runBiome("clean", null);
  summary.biome_fixture_config = { exit_violations: v.exit, exit_clean: c.exit, errors_violations: v.violations.length, errors_clean: c.violations.length, ms_violations: r1(v.ms), biome_scan_ms: v.biomeDurationMs };
}

log("evasions");
summary.evasions = evasionMatrix();

log("compat");
summary.compat = compatSection();

if (!process.env.SP7_SKIP_SCALE) { log("scale"); summary.scale = scaleSection(); }

// ------------------------------------------------------------------ gate verdicts
const primary = {
  "check:boundaries": summary.boundaries.tokens.gate_ok && summary.boundaries.tsgo.gate_ok && summary.boundaries.both.gate_ok,
  "check:jev-index": summary.jev_index.tokens.gate_ok,
  "check:sql": summary.sql_template.tokens.gate_ok,
  "check:ng-g": summary.ng_g.tokens.gate_ok,
};
summary.verdict = { primary_gates_exit_codes_ok: primary, all_ok: Object.values(primary).every(Boolean) };

mkdirSync(path.join(ROOT, "results"), { recursive: true });
writeFileSync(path.join(ROOT, "results", "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exit(summary.verdict.all_ok ? 0 : 1);
