import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const SRC_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "graphify-out", ".turbo"]);

export function parseArgs(argv = process.argv.slice(2)) {
  const a = { root: process.cwd(), json: false, engine: undefined, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--root") a.root = path.resolve(argv[++i]);
    else if (x.startsWith("--root=")) a.root = path.resolve(x.slice(7));
    else if (x === "--json") a.json = true;
    else if (x === "--quiet") a.quiet = true;
    else if (x.startsWith("--engine=")) a.engine = x.slice(9);
  }
  return a;
}

/** Recursively list files under root (posix-style relative paths). */
export function walk(root, exts) {
  const out = [];
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) rec(full); continue; }
      if (!exts || exts.has(path.extname(name))) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  rec(root);
  return out.sort();
}

export const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");

/** camelCase / PascalCase / kebab / snake / SCREAMING -> lower snake words joined by "_". */
export function snake(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

/**
 * Finish a check: print results, exit 1 on any error-level violation.
 * violations: [{file,line,rule,message,level?}]
 */
export function finish(name, root, violations, opts, extra = {}) {
  const seen = new Set();
  const uniq = [];
  for (const v of violations) {
    const k = `${v.file}:${v.line}:${v.rule}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ level: "error", ...v });
  }
  uniq.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  const errors = uniq.filter((v) => v.level === "error");
  if (opts.json) {
    process.stdout.write(JSON.stringify({ check: name, root, errors: errors.length, warnings: uniq.length - errors.length, violations: uniq, ...extra }) + "\n");
  } else if (!opts.quiet) {
    for (const v of uniq) console.log(`${v.file}:${v.line}  ${v.level}  ${v.rule}  ${v.message}`);
    console.log(`[${name}] ${errors.length} error(s), ${uniq.length - errors.length} warning(s) in ${root}`);
  }
  process.exit(errors.length ? 1 : 0);
}

/** Load // EXPECT[rule] markers (also C-style comments) from files: -> Set("file:line:rule") */
export function loadExpectations(root, files, rulePrefixes) {
  const exp = new Set();
  for (const f of files) {
    const text = readFileSync(path.join(root, f), "utf8").split("\n");
    text.forEach((line, idx) => {
      for (const m of line.matchAll(/EXPECT(-NEXT)?\[([^\]]+)\]/g)) {
        const rule = m[2];
        if (rulePrefixes && !rulePrefixes.some((p) => rule.startsWith(p))) continue;
        exp.add(`${f}:${idx + 1 + (m[1] ? 1 : 0)}:${rule}`);
      }
    });
  }
  return exp;
}
