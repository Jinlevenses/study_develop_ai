#!/usr/bin/env node
// check:sql  -- SQL template scan (SER: injection / NFR-SEC)
// Flags SQL text built at runtime and passed to `.prepare(...)` / `.exec(...)` (node:sqlite DatabaseSync):
//   sql/template-interp  `...${x}...`
//   sql/concat           "..." + x   |  "...".concat(x)
//   sql/tainted-var      const q = <interp|concat>;  q += "..." + x;  db.prepare(q)   (in-file dataflow, by name)
//   sql/dynamic-arg      argument is a parameter / member / call result we cannot prove static
// Allowed: string literal, template literal without ${}, literal + literal, ${ident(x)} / ${placeholders(n)} / ${sqlInt(n)},
//          imported UPPER_SNAKE constants, `// sql-ok: <reason>` pragma on the same/previous line.
// Placeholders (?, ?NNN, :name, $name, @name) are just text inside literals and are always fine.
import { parseArgs, walk, read, SRC_EXT, finish } from "./lib/common.mjs";
import { tokenize, callArgs } from "./lib/lex.mjs";

export const SANCTIONED_HELPERS = new Set(["ident", "sqlIdent", "placeholders", "sqlInt"]);
const REGEX_RECEIVER = /^(re|rx|regex|regexp|pattern|matcher|[A-Za-z0-9_]*(Re|RE|Regex|Regexp|Pattern|_RE|_REGEX))$/;
const OPERATOR_TOKENS = new Set(["+", "=", "(", ",", "?", ":", "&&", "||", "??", "."]);

const isLit = (t) => t.t === "str" || (t.t === "tpl" && t.exprs.length === 0);
const isSanctionedExpr = (ex) => ex.tokens.length >= 3 && ex.tokens[0].t === "id" && SANCTIONED_HELPERS.has(ex.tokens[0].v) && ex.tokens[1].v === "(" ;

/** Split tokens at depth-0 `+`. */
function splitPlus(toks) {
  const parts = []; let cur = []; let d = 0;
  for (const t of toks) {
    if (t.t === "p" && "([{".includes(t.v)) d++;
    if (t.t === "p" && ")]}".includes(t.v)) d--;
    if (d === 0 && t.t === "p" && t.v === "+") { parts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

/** Classify an expression token list. Returns {kind:'ok'|'interp'|'concat'|'ident'|'dynamic', line}. */
function classify(toks) {
  if (!toks.length) return { kind: "ok", line: 0 };
  const line = toks[0].line;
  // strip wrapping parens
  if (toks[0].v === "(" && toks[toks.length - 1].v === ")" && toks.length > 2) return classify(toks.slice(1, -1));
  // cond ? "lit" : "lit"  -> ok iff both branches are ok (the condition is not SQL text)
  { let d = 0, q = -1, c = -1;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === "p" && "([{".includes(t.v)) d++;
      else if (t.t === "p" && ")]}".includes(t.v)) d--;
      else if (d === 0 && t.t === "p" && t.v === "?" && q < 0) q = k;
      else if (d === 0 && t.t === "p" && t.v === ":" && q >= 0 && c < 0) c = k;
    }
    if (q > 0 && c > q) {
      const a = classify(toks.slice(q + 1, c)), b = classify(toks.slice(c + 1));
      if (a.kind === "ok" && b.kind === "ok") return { kind: "ok", line };
      return { kind: a.kind !== "ok" ? a.kind : b.kind, line };
    }
  }
  const parts = splitPlus(toks);
  if (parts.length > 1) {
    const kinds = parts.map((p) => classify(p));
    if (kinds.every((k) => k.kind === "ok")) return { kind: "ok", line };
    return { kind: "concat", line };
  }
  if (toks.length === 1) {
    const t = toks[0];
    if (t.t === "str") return { kind: "ok", line };
    if (t.t === "tpl") {
      if (!t.exprs.length) return { kind: "ok", line };
      return t.exprs.every(isSanctionedExpr) ? { kind: "ok", line } : { kind: "interp", line: t.line };
    }
    if (t.t === "id") return { kind: "ident", name: t.v, line };
    return { kind: "dynamic", line };
  }
  // "lit".concat(x) / ("lit" + "lit").concat(...)
  const di = toks.findIndex((t, k) => t.v === "." && toks[k + 1]?.v === "concat" && toks[k + 2]?.v === "(");
  if (di > 0 && classify(toks.slice(0, di)).kind === "ok") {
    const { args } = callArgs(toks, di + 2);
    return args.every((a) => classify(a).kind === "ok") ? { kind: "ok", line } : { kind: "concat", line };
  }
  return { kind: "dynamic", line };
}

/** Find the RHS token slice of an assignment starting at token index `eq` (the '=' or '+=' token). */
function rhsAfter(toks, eq) {
  const out = []; let d = 0;
  for (let k = eq + 1; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === "p" && "([{".includes(t.v)) d++;
    if (t.t === "p" && ")]}".includes(t.v)) { if (d === 0) break; d--; }
    if (d === 0 && t.t === "p" && t.v === ";") break;
    if (d === 0 && out.length) {
      const prev = out[out.length - 1];
      const startsNewStmt = t.line > prev.line && !(prev.t === "p" && OPERATOR_TOKENS.has(prev.v)) && !(t.t === "p" && OPERATOR_TOKENS.has(t.v));
      if (startsNewStmt) break;
    }
    out.push(t);
  }
  return out;
}

function findAssignments(tokens, name) {
  const res = [];
  for (let k = 0; k < tokens.length - 1; k++) {
    const t = tokens[k];
    if (t.t !== "id" || t.v !== name) continue;
    if (tokens[k - 1]?.v === ".") continue;
    const n = tokens[k + 1];
    if (n?.t === "p" && (n.v === "=" || n.v === "+=")) res.push({ op: n.v, rhs: rhsAfter(tokens, k + 1), decl: ["const", "let", "var"].includes(tokens[k - 1]?.v) });
  }
  return res;
}

const importedNames = (tokens) => {
  const set = new Set();
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].v === "import" && tokens[k].t === "id") {
      let j = k + 1;
      while (j < tokens.length && !(tokens[j].v === "from" && tokens[j + 1]?.t === "str")) { if (tokens[j].t === "id") set.add(tokens[j].v); if (tokens[j].t === "str") break; j++; }
    }
  }
  return set;
};

export function checkFile(rel, src) {
  const { tokens, comments } = tokenize(src);
  const v = [];
  const pragmaLines = new Set();
  for (const c of comments) {
    const m = /(?:sql-ok|biome-ignore\s+lint\/plugin(?:\/\S+)?):\s*(\S.*)/.exec(c.v); // same escape hatch works for Biome and this scanner
    if (m) { pragmaLines.add(c.line); pragmaLines.add(c.line + 1); pragmaLines.add(c.line + 2); }
  }
  const imported = importedNames(tokens);

  const scan = (list) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.t === "tpl") for (const ex of t.exprs) scan(ex.tokens);
      if (t.t !== "id" || (t.v !== "prepare" && t.v !== "exec")) continue;
      const dot = list[i - 1];
      if (!dot || dot.t !== "p" || (dot.v !== "." && dot.v !== "?.") || list[i + 1]?.v !== "(") continue;
      const recv = list[i - 2];
      if (recv?.t === "re" || (recv?.t === "id" && REGEX_RECEIVER.test(recv.v))) continue; // RegExp#exec
      const { args } = callArgs(list, i + 1);
      const a = args[0];
      if (!a || !a.length) continue;
      const callLine = a[0].line;
      const pragma = pragmaLines.has(t.line) || pragmaLines.has(callLine);
      const c = classify(a);
      const which = t.v;
      if (c.kind === "ok") continue;
      if (pragma) continue;
      if (c.kind === "interp") v.push({ file: rel, line: c.line, rule: "sql/template-interp", message: `.${which}() argument interpolates \${...} into SQL text; bind with ?/:name or wrap identifiers in ident()` });
      else if (c.kind === "concat") v.push({ file: rel, line: callLine, rule: "sql/concat", message: `.${which}() argument is built by string concatenation` });
      else if (c.kind === "ident") {
        const asg = findAssignments(list, c.name);
        if (!asg.length) {
          if (imported.has(c.name) && /^[A-Z][A-Z0-9_]*$/.test(c.name)) continue; // imported constant: verified at its own module
          v.push({ file: rel, line: callLine, rule: "sql/dynamic-arg", message: `.${which}(${c.name}): argument is not a provable constant (parameter/unknown). Use a literal or add "// sql-ok: <reason>"` });
        } else {
          let bad = false;
          for (const s of asg) {
            const k = classify(s.rhs);
            if (k.kind === "interp" || k.kind === "concat") { bad = true; v.push({ file: rel, line: s.rhs[0]?.line ?? callLine, rule: "sql/tainted-var", message: `"${c.name}" is built with ${k.kind} and later passed to .${which}()` }); }
            else if (k.kind !== "ok" && s.op === "=") { bad = true; v.push({ file: rel, line: callLine, rule: "sql/dynamic-arg", message: `.${which}(${c.name}): assigned from a non-constant expression` }); }
          }
          void bad;
        }
      } else v.push({ file: rel, line: callLine, rule: "sql/dynamic-arg", message: `.${which}() argument is a dynamic expression (call/member/array). Use a literal or add "// sql-ok: <reason>"` });
    }
  };
  scan(tokens);
  return v;
}

export function run(root) {
  const files = walk(root, SRC_EXT);
  const out = [];
  for (const f of files) out.push(...checkFile(f, read(root, f)));
  return { files: files.length, violations: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const { files, violations } = run(opts.root);
  finish("check:sql", opts.root, violations, opts, { files });
}
