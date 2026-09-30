#!/usr/bin/env node
// check:boundaries  (NFR-MAINT-001/002)
//   No import from one service into another. Only packages/contracts, packages/shared-kernel (+ design-tokens) are shareable.
//   Also: a service must not open another service's SQLite file (NFR-MAINT-002).
// Engines for specifier extraction (same policy, different extractor):
//   tokens (default) : src/lib/lex.mjs tokenizer (comment/string aware, TS + TSX tolerant)
//   lexer            : es-module-lexer on raw TS source
//   regex            : naive line regex (baseline for comparison)
// Usage: node src/check-boundaries.mjs --root <dir> [--engine=tokens|lexer|regex] [--json]
import path from "node:path";
import { init, parse as lexerParse } from "es-module-lexer";
import { parseArgs, walk, read, SRC_EXT, finish } from "./lib/common.mjs";
import { tokenize, callArgs } from "./lib/lex.mjs";

export const POLICY = {
  unitPattern: /^(services|apps|packages)\/([^/]+)\//,
  shared: new Set(["packages/contracts", "packages/shared-kernel", "packages/design-tokens"]),
  // workspace package name -> unit dir
  aliases: [
    { re: /^@fathom\/svc-([^/]+)(\/|$)/, unit: (m) => `services/${m[1]}` },
    { re: /^@fathom\/app-([^/]+)(\/|$)/, unit: (m) => `apps/${m[1]}` },
    { re: /^@fathom\/([^/]+)(\/|$)/, unit: (m) => `packages/${m[1]}` },
  ],
};

const unitOf = (rel) => {
  const m = POLICY.unitPattern.exec(rel + (rel.endsWith("/") ? "" : "/x")); // allow dir-ish
  return m ? `${m[1]}/${m[2]}` : null;
};

/** Resolve an import specifier found in `fromFile` (root-relative) to a unit, or null (external/builtin/unknown). */
export function targetUnit(spec, fromFile) {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    return unitOf(abs);
  }
  if (spec.startsWith("node:")) return null;
  for (const a of POLICY.aliases) { const m = a.re.exec(spec); if (m) return a.unit(m); }
  if (/^(services|apps|packages)\//.test(spec)) return unitOf(spec); // baseUrl-style
  return null;
}

// ---- extraction engines: return [{spec,line,kind}] ----
function extractTokens(src) {
  const { tokens, lineOf } = tokenize(src);
  const out = [];
  const isStr = (t) => t && (t.t === "str" || (t.t === "tpl" && t.exprs.length === 0));
  const val = (t) => (t.t === "str" ? t.v : t.quasis[0].v);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== "id") continue;
    const prev = tokens[i - 1]; const next = tokens[i + 1];
    if (prev && prev.t === "p" && prev.v === ".") { // import.meta.glob("...")
      if (t.v === "glob" && next?.v === "(" && isStr(tokens[i + 2]) ) out.push({ spec: val(tokens[i + 2]), line: t.line, kind: "glob" });
      continue;
    }
    if (t.v === "from" && isStr(next)) out.push({ spec: val(next), line: next.line, kind: "static" });
    else if (t.v === "import" && isStr(next)) out.push({ spec: val(next), line: next.line, kind: "side-effect" });
    else if ((t.v === "import" || t.v === "require") && next?.t === "p" && next.v === "(") {
      const { args } = callArgs(tokens, i + 1);
      if (args[0]?.length === 1 && isStr(args[0][0])) out.push({ spec: val(args[0][0]), line: t.line, kind: t.v === "import" ? "dynamic" : "require" });
      else out.push({ spec: null, line: t.line, kind: "nonliteral-" + t.v });
    }
  }
  return { imports: out, tokens, lineOf };
}

let lexerReady = false;
async function extractLexer(src) {
  if (!lexerReady) { await init; lexerReady = true; }
  const [imps] = lexerParse(src);
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;
  // es-module-lexer >= 3 lexes TypeScript (incl. `import type`); it does not know `require()`.
  return { imports: imps.filter((i) => i.type !== "import-meta").map((i) => ({ spec: i.specifier ?? null, line: lineOf(i.importStart), kind: i.type === "dynamic" ? "dynamic" : i.typeOnly ? "type-only" : "static" })) };
}

function extractRegex(src) {
  const out = [];
  src.split("\n").forEach((l, idx) => {
    for (const m of l.matchAll(/(?:from|import|require\()\s*\(?\s*["']([^"']+)["']/g)) out.push({ spec: m[1], line: idx + 1, kind: "regex" });
  });
  return { imports: out };
}

/** Returns violations for one file. */
export async function checkFile(rel, src, engine = "tokens") {
  const own = unitOf(rel);
  const v = [];
  if (!own) return v; // files outside any unit (root config) are not governed
  let ex;
  try {
    ex = engine === "lexer" ? await extractLexer(src) : engine === "regex" ? extractRegex(src) : extractTokens(src);
  } catch (e) {
    return [{ file: rel, line: 1, rule: "boundary/unparseable", message: `${engine} engine failed: ${String(e.message).split("\n")[0]}` }];
  }
  for (const imp of ex.imports) {
    if (imp.spec == null) { v.push({ file: rel, line: imp.line, rule: "boundary/nonliteral-import", level: "warn", message: `${imp.kind}: specifier is not a string literal (cannot verify)` }); continue; }
    const tgt = targetUnit(imp.spec, rel);
    if (!tgt || tgt === own || POLICY.shared.has(tgt)) continue;
    v.push({ file: rel, line: imp.line, rule: "boundary/cross-service-import", message: `${own} -> ${tgt} via "${imp.spec}" (${imp.kind}); only ${[...POLICY.shared].join(", ")} may be shared` });
  }
  // NFR-MAINT-002: DatabaseSync(<path referring to another unit>)   (tokens engine only; needs call args)
  if (engine === "tokens" && ex.tokens) {
    const toks = ex.tokens;
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i].t === "id" && toks[i].v === "DatabaseSync" && toks[i + 1].v === "(" && toks[i - 1]?.v === "new") {
        const { args } = callArgs(toks, i + 1);
        const flat = (args[0] ?? []);
        const strs = flat.filter((t) => t.t === "str").map((t) => t.v);
        const usesDir = flat.some((t) => t.t === "id" && (t.v === "__dirname" || t.v === "dirname")) || flat.some((t, k) => t.v === "import" && flat[k + 2]?.v === "dirname");
        if (!strs.length) continue;
        const joined = strs.length === 1 && strs[0].includes("/") ? strs[0] : strs.join("/");
        const abs = path.posix.normalize(usesDir ? path.posix.join(path.posix.dirname(rel), joined) : joined);
        const tu = unitOf(abs.replace(/^\.\//, ""));
        if (tu && tu !== own && !POLICY.shared.has(tu)) v.push({ file: rel, line: toks[i].line, rule: "boundary/db-path", message: `${own} opens a DB file owned by ${tu} ("${abs}")` });
      }
    }
  }
  return v;
}

/** engine "tsgo": module resolution done by the native compiler (tsconfig paths, package exports, symlinks) via typescript/unstable/sync. */
async function runTsgo(root) {
  const { openProject } = await import("./lib/tsgo.mjs");
  const { SyntaxKind } = await import("typescript/unstable/ast");
  const p = await openProject(root);
  const out = [];
  try {
    for (const abs of p.files) {
      const rel = path.relative(root, abs).split(path.sep).join("/");
      const own = unitOf(rel);
      if (!own) continue;
      const sf = p.program.getSourceFile(abs);
      const seen = new Set();
      const handle = (spec) => {
        const key = spec.pos;
        if (seen.has(key)) return; seen.add(key);
        const sym = p.checker.getSymbolAtLocation(spec);
        const symPath = sym?.name?.replace(/^"|"$/g, "");                 // module symbols are named "\"<abs path w/o ext>\""
        const resolved = symPath && path.isAbsolute(symPath) ? path.relative(root, symPath).split(path.sep).join("/") : null;
        const tgt = resolved ? unitOf(resolved) : targetUnit(spec.text, rel); // unresolved -> fall back to naming convention
        if (!tgt || tgt === own || POLICY.shared.has(tgt)) return;
        const line = sf.getLineAndCharacterOfPosition(spec.getStart?.(sf) ?? spec.pos).line + 1;
        out.push({ file: rel, line, rule: "boundary/cross-service-import", message: `${own} -> ${tgt} via "${spec.text}" (resolved: ${resolved ?? "n/a"})` });
      };
      for (const spec of sf.imports ?? []) handle(spec);          // static import/export-from/import()/require in TS files as collected by the compiler
      const walkNode = (n) => {                                        // require("x") and import("x") (belt and braces)
        if (n.kind === SyntaxKind.CallExpression && n.arguments?.length === 1 && (n.expression.kind === SyntaxKind.ImportKeyword || (n.expression.kind === SyntaxKind.Identifier && n.expression.text === "require"))
          && (n.arguments[0].kind === SyntaxKind.StringLiteral || n.arguments[0].kind === SyntaxKind.NoSubstitutionTemplateLiteral)) handle(n.arguments[0]);
        n.forEachChild(walkNode);
      };
      walkNode(sf);
      // db-path (needs call args) reuses the token engine
      out.push(...(await checkFile(rel, read(root, rel), "tokens")).filter((v) => v.rule === "boundary/db-path"));
    }
  } finally { p.close(); }
  return { files: p.files.length, violations: out };
}

export async function run(root, engine) {
  if (engine === "tsgo") return runTsgo(root);
  if (engine === "both") {                                   // recommended gate: tokens (no deps, catches naming-convention + db-path) UNION tsgo (resolves aliases)
    const t = await run(root, "tokens");
    const g = await runTsgo(root);                            // throws -> exit code 2 (fail closed; never silently degrade)
    const seen = new Set(); const violations = [];
    for (const v of [...t.violations, ...g.violations]) { const k = `${v.file}:${v.line}:${v.rule}`; if (!seen.has(k)) { seen.add(k); violations.push(v); } }
    return { files: g.files, violations };
  }
  const files = walk(root, SRC_EXT);
  const all = [];
  for (const f of files) all.push(...(await checkFile(f, read(root, f), engine)));
  return { files: files.length, violations: all };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const engine = opts.engine ?? "tokens";
  let res;
  try { res = await run(opts.root, engine); } catch (e) { console.error(`[check:boundaries] engine "${engine}" failed: ${e.message}`); process.exit(2); }
  finish(`check:boundaries[${engine}]`, opts.root, res.violations, opts, { engine, files: res.files });
}
