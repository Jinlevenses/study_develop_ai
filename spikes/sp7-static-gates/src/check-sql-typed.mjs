#!/usr/bin/env node
// check:sql (type-aware PoC) -- same policy as check-sql-template.mjs, but the receiver is identified by TYPE
// (DatabaseSync#prepare / #exec resolved by the native compiler through typescript/unstable/sync) instead of by name,
// and identifier arguments are resolved to their declaration (same or other file) instead of an in-file name lookup.
// Catches: db["prepare"](...), bound/aliased methods, .call/.apply, imported SQL constants; ignores RegExp#exec by construction.
import path from "node:path";
import { readFileSync } from "node:fs";
import { parseArgs, finish } from "./lib/common.mjs";
import { openProject } from "./lib/tsgo.mjs";

const SANCTIONED = new Set(["ident", "sqlIdent", "placeholders", "sqlInt"]);
const SQL_CLASSES = new Set(["DatabaseSync"]);        // node:sqlite
const SQL_METHODS = new Set(["prepare", "exec"]);

export async function run(root) {
  const { SyntaxKind, NodeFlags } = await import("typescript/unstable/ast");
  const p = await openProject(root);
  const violations = [];
  const textCache = new Map();
  const linesOf = (file) => textCache.get(file) ?? (textCache.set(file, readFileSync(file, "utf8").split("\n")), textCache.get(file));
  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart?.(sf) ?? node.pos).line + 1;
  const rel = (f) => path.relative(root, f).split(path.sep).join("/");
  const pragma = (file, line) => [line, line - 1, line - 2].some((l) => /(?:sql-ok|biome-ignore\s+lint\/plugin(?:\/\S+)?):\s*\S/.test(linesOf(file)[l - 1] ?? ""));

  /** classify an expression node -> {kind:'ok'|'interp'|'concat'|'dynamic'|'tainted', node?, file?} */
  function classify(n, sf, depth = 0) {
    if (depth > 6) return { kind: "dynamic" };
    switch (n.kind) {
      case SyntaxKind.StringLiteral: case SyntaxKind.NoSubstitutionTemplateLiteral: return { kind: "ok" };
      case SyntaxKind.ParenthesizedExpression: case SyntaxKind.AsExpression: case SyntaxKind.NonNullExpression: case SyntaxKind.SatisfiesExpression: return classify(n.expression, sf, depth + 1);
      case SyntaxKind.TemplateExpression:
        return n.templateSpans.every((s) => s.expression.kind === SyntaxKind.CallExpression && s.expression.expression.kind === SyntaxKind.Identifier && SANCTIONED.has(s.expression.expression.text)) ? { kind: "ok" } : { kind: "interp", node: n, sf };
      case SyntaxKind.BinaryExpression: {
        if (n.operatorToken.kind !== SyntaxKind.PlusToken) return { kind: "dynamic" };
        const l = classify(n.left, sf, depth + 1), r = classify(n.right, sf, depth + 1);
        return l.kind === "ok" && r.kind === "ok" ? { kind: "ok" } : { kind: "concat", node: n, sf };
      }
      case SyntaxKind.ConditionalExpression: {
        const a = classify(n.whenTrue, sf, depth + 1), b = classify(n.whenFalse, sf, depth + 1);
        return a.kind === "ok" && b.kind === "ok" ? { kind: "ok" } : (a.kind !== "ok" ? a : b);
      }
      case SyntaxKind.Identifier: {
        const sym = p.checker.getSymbolAtLocation(n);
        const decl = sym?.valueDeclaration?.resolve(p.project);
        if (!decl || decl.kind !== SyntaxKind.VariableDeclaration || !decl.initializer) return { kind: "dynamic" };   // parameter, import binding without initializer, ...
        const isConst = (decl.parent.flags & NodeFlags.Const) !== 0;
        if (!isConst) return { kind: "dynamic" };                                                                    // let/var: reassignment not tracked
        const declSf = decl.getSourceFile?.() ?? sf;
        const k = classify(decl.initializer, declSf, depth + 1);
        return k.kind === "interp" || k.kind === "concat" ? { kind: "tainted", node: decl.initializer, sf: declSf, via: k.kind } : k;
      }
      default: return { kind: "dynamic" };
    }
  }

  /** is this call DatabaseSync#prepare/exec? (direct, element access, bind(), call()/apply()) */
  function sqlTarget(call) {
    let sig; try { sig = p.checker.getResolvedSignature(call); } catch { return null; }
    let decl = sig?.declaration?.resolve(p.project);
    if (!decl) return null;
    let via = "direct";
    if (decl.parent?.name?.text === "CallableFunction" && (decl.name?.text === "call" || decl.name?.text === "apply") && call.expression.kind === SyntaxKind.PropertyAccessExpression) {
      const inner = call.expression.expression;                         // db.prepare   (in db.prepare.call(db, sql))
      const s = p.checker.getSymbolAtLocation(inner.kind === SyntaxKind.PropertyAccessExpression ? inner.name : inner);
      decl = s?.valueDeclaration?.resolve(p.project); via = decl?.name?.text === undefined ? via : ".call/.apply";
      if (!decl) return null;
      return SQL_CLASSES.has(decl.parent?.name?.text) && SQL_METHODS.has(decl.name?.text) ? { method: decl.name.text, via, argIndex: 1 } : null;
    }
    return SQL_CLASSES.has(decl.parent?.name?.text) && SQL_METHODS.has(decl.name?.text) ? { method: decl.name.text, via, argIndex: 0 } : null;
  }

  try {
    for (const abs of p.files) {
      const sf = p.program.getSourceFile(abs);
      const file = rel(abs);
      const visit = (n) => {
        if (n.kind === SyntaxKind.CallExpression) {
          const t = sqlTarget(n);
          const arg = t && n.arguments[t.argIndex];
          if (arg) {
            const line = lineOf(sf, arg);
            const c = classify(arg, sf);
            const ok = c.kind === "ok" || pragma(abs, line);
            if (!ok) {
              if (c.kind === "interp") violations.push({ file, line: lineOf(sf, c.node), rule: "sql/template-interp", message: `.${t.method}(): \${...} interpolated into SQL (${t.via})` });
              else if (c.kind === "concat") violations.push({ file, line, rule: "sql/concat", message: `.${t.method}(): SQL built by concatenation (${t.via})` });
              else if (c.kind === "tainted") violations.push({ file: rel(c.sf.fileName), line: lineOf(c.sf, c.node), rule: "sql/tainted-var", message: `constant built with ${c.via} is passed to .${t.method}() in ${file}:${line}` });
              else violations.push({ file, line, rule: "sql/dynamic-arg", message: `.${t.method}(): argument is not a provable constant (${t.via})` });
            }
          }
        }
        n.forEachChild(visit);
      };
      visit(sf);
    }
  } finally { p.close(); }
  return { files: p.files.length, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const { files, violations } = await run(opts.root);
  finish("check:sql[tsgo-typed]", opts.root, violations, opts, { files });
}
