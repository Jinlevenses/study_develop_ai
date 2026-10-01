#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-sql-typed.mjs (audit-fixed: 엔진 예외·tsconfig 부재·프로젝트 파일 0 → exit 2(openProject·runGate), SqlitePort 수신자 추가(설정), `+`·`.concat` 연결은 sql/concat(감사 A.2-4), 탈출구 hasEscape(사유 필수), 규칙 ID는 check:sql과 동일 sql/*)
// check:sql-typed (NFR-SEC-016, STD-SQL-06) — check:sql과 같은 정책을 tsgo 타입 정보로 판정한다.
//   수신자 = 메서드 심볼의 선언 클래스·인터페이스 이름 ∈ receivers.types ∧ 메서드 이름 ∈ receivers.methods (config/sql.json).
//   잡는 것: db['prepare'](…), .bind·.call·.apply 경유, 별칭, import한 SQL 상수. 배제: RegExp#exec(구조적).
// 사용: node tools/gates/check-sql-typed.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadSqlConfig } from './check-sql-template.mjs';
import { hasEscape, isMain, runGate } from './lib/common.mjs';
import { openProject } from './lib/tsgo.mjs';
import { isExcludedPath } from './lib/walk.mjs';

const ESCAPE_TAGS = ['sql-ok', 'biome-ignore lint/plugin'];

export async function analyze(root, opts = {}) {
  const cfg = loadSqlConfig(opts.config);
  const SANCTIONED = new Set(cfg.sanctioned_helpers);
  const SQL_CLASSES = new Set(cfg.receivers.types);
  const SQL_METHODS = new Set(cfg.receivers.methods);
  const { SyntaxKind, NodeFlags } = await import('typescript/unstable/ast');
  const p = await openProject(root);
  const violations = [];
  const textCache = new Map();
  const linesOf = (file) => {
    if (!textCache.has(file)) {
      textCache.set(file, readFileSync(file, 'utf8').split('\n'));
    }
    return textCache.get(file);
  };
  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart?.(sf) ?? node.pos).line + 1;
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const escaped = (file, line) => ESCAPE_TAGS.some((tag) => hasEscape(linesOf(file), line, tag));

  /** 선언을 둘러싼 이름 있는 타입(클래스·인터페이스·타입 별칭)의 이름. */
  const ownerName = (decl) => {
    const parent = decl?.parent;
    if (parent?.name?.text) {
      return parent.name.text;
    }
    return parent?.parent?.name?.text; // type Port = { prepare(sql: string): unknown }
  };

  /** 표현식 분류 → {kind: 'ok'|'interp'|'concat'|'dynamic'|'tainted', node?, sf?} */
  function classify(n, sf, depth = 0) {
    if (depth > 6) {
      return { kind: 'dynamic' };
    }
    switch (n.kind) {
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NoSubstitutionTemplateLiteral:
        return { kind: 'ok' };
      case SyntaxKind.ParenthesizedExpression:
      case SyntaxKind.AsExpression:
      case SyntaxKind.NonNullExpression:
      case SyntaxKind.SatisfiesExpression:
        return classify(n.expression, sf, depth + 1);
      case SyntaxKind.TemplateExpression:
        return n.templateSpans.every(
          (s) =>
            s.expression.kind === SyntaxKind.CallExpression &&
            s.expression.expression.kind === SyntaxKind.Identifier &&
            SANCTIONED.has(s.expression.expression.text),
        )
          ? { kind: 'ok' }
          : { kind: 'interp', node: n, sf };
      case SyntaxKind.BinaryExpression: {
        if (n.operatorToken.kind !== SyntaxKind.PlusToken) {
          return { kind: 'dynamic' };
        }
        const l = classify(n.left, sf, depth + 1);
        const r = classify(n.right, sf, depth + 1);
        return l.kind === 'ok' && r.kind === 'ok' ? { kind: 'ok' } : { kind: 'concat', node: n, sf };
      }
      case SyntaxKind.CallExpression: {
        // 'lit'.concat(x) — 연결(감사 A.2-4: dynamic-arg가 아니라 concat)
        const e = n.expression;
        if (e.kind === SyntaxKind.PropertyAccessExpression && e.name?.text === 'concat') {
          const recv = classify(e.expression, sf, depth + 1);
          const allOk = recv.kind === 'ok' && n.arguments.every((a) => classify(a, sf, depth + 1).kind === 'ok');
          return allOk ? { kind: 'ok' } : { kind: 'concat', node: n, sf };
        }
        return { kind: 'dynamic' };
      }
      case SyntaxKind.ConditionalExpression: {
        const a = classify(n.whenTrue, sf, depth + 1);
        const b = classify(n.whenFalse, sf, depth + 1);
        return a.kind === 'ok' && b.kind === 'ok' ? { kind: 'ok' } : a.kind !== 'ok' ? a : b;
      }
      case SyntaxKind.Identifier: {
        const sym = p.checker.getSymbolAtLocation(n);
        const decl = sym?.valueDeclaration?.resolve(p.project);
        if (!decl || decl.kind !== SyntaxKind.VariableDeclaration || !decl.initializer) {
          return { kind: 'dynamic' }; // 매개변수·초기값 없는 바인딩
        }
        const isConst = (decl.parent.flags & NodeFlags.Const) !== 0;
        if (!isConst) {
          return { kind: 'dynamic' }; // let/var: 재대입 추적 안 함
        }
        const declSf = decl.getSourceFile?.() ?? sf;
        const k = classify(decl.initializer, declSf, depth + 1);
        return k.kind === 'interp' || k.kind === 'concat'
          ? { kind: 'tainted', node: decl.initializer, sf: declSf, via: k.kind }
          : k;
      }
      default:
        return { kind: 'dynamic' };
    }
  }

  /** 이 호출이 수신자 타입의 prepare/exec인가(직접·요소 접근·bind·call/apply). */
  function sqlTarget(call) {
    let sig;
    try {
      sig = p.checker.getResolvedSignature(call);
    } catch {
      return null;
    }
    let decl = sig?.declaration?.resolve(p.project);
    if (!decl) {
      return null;
    }
    let via = 'direct';
    if (
      decl.parent?.name?.text === 'CallableFunction' &&
      (decl.name?.text === 'call' || decl.name?.text === 'apply') &&
      call.expression.kind === SyntaxKind.PropertyAccessExpression
    ) {
      const inner = call.expression.expression; // db.prepare (in db.prepare.call(db, sql))
      const s = p.checker.getSymbolAtLocation(inner.kind === SyntaxKind.PropertyAccessExpression ? inner.name : inner);
      decl = s?.valueDeclaration?.resolve(p.project);
      via = '.call/.apply';
      if (!decl) {
        return null;
      }
      return SQL_CLASSES.has(ownerName(decl)) && SQL_METHODS.has(decl.name?.text)
        ? { method: decl.name.text, via, argIndex: 1 }
        : null;
    }
    return SQL_CLASSES.has(ownerName(decl)) && SQL_METHODS.has(decl.name?.text)
      ? { method: decl.name.text, via, argIndex: 0 }
      : null;
  }

  let scanned = 0;
  try {
    for (const abs of p.files) {
      const file = rel(abs);
      if (isExcludedPath(file)) {
        continue;
      }
      const sf = p.program.getSourceFile(abs);
      if (!sf) {
        continue;
      }
      scanned++;
      const visit = (n) => {
        if (n.kind === SyntaxKind.CallExpression) {
          const t = sqlTarget(n);
          const arg = t && n.arguments[t.argIndex];
          if (arg) {
            const line = lineOf(sf, arg);
            const c = classify(arg, sf);
            const ok = c.kind === 'ok' || escaped(abs, line) || escaped(abs, lineOf(sf, n));
            if (!ok) {
              if (c.kind === 'interp') {
                violations.push({ file, line: lineOf(sf, c.node), rule: 'sql/template-interp', message: `.${t.method}(): \${...} interpolated into SQL (${t.via})` });
              } else if (c.kind === 'concat') {
                violations.push({ file, line, rule: 'sql/concat', message: `.${t.method}(): SQL built by concatenation (${t.via})` });
              } else if (c.kind === 'tainted') {
                violations.push({
                  file: rel(c.sf.fileName),
                  line: lineOf(c.sf, c.node),
                  rule: 'sql/tainted-var',
                  message: `constant built with ${c.via} is passed to .${t.method}() in ${file}:${line}`,
                });
              } else {
                violations.push({ file, line, rule: 'sql/dynamic-arg', message: `.${t.method}(): argument is not a provable constant (${t.via})` });
              }
            }
          }
        }
        n.forEachChild(visit);
      };
      visit(sf);
    }
  } finally {
    p.close();
  }
  return { files: scanned, violations: violations.map((v) => ({ ...v, severity: 'error' })) };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:sql-typed', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
