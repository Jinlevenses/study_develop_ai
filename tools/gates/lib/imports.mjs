// ported-from: spikes/sp7-static-gates/src/check-boundaries.mjs extractTokens (audit-fixed: export-from·create-require·typeOnly·템플릿 식 내부 구분, 비리터럴 구분)
import { callArgs, deepTokens, tokenize } from './lex.mjs';

const isStr = (t) => t !== undefined && (t.t === 'str' || (t.t === 'tpl' && t.exprs.length === 0));
const strVal = (t) => (t.t === 'str' ? t.v : t.quasis[0].v);

/** `from '…'` 앞쪽에서 문장 시작(`import`/`export`) 토큰 인덱스를 찾는다. */
function statementStart(tokens, fromIdx) {
  for (let k = fromIdx - 1; k >= 0 && fromIdx - k < 400; k--) {
    const t = tokens[k];
    if (t.t === 'p' && t.v === ';') {
      return -1;
    }
    if (t.t === 'id' && (t.v === 'import' || t.v === 'export')) {
      const prev = tokens[k - 1];
      if (prev && prev.t === 'p' && prev.v === '.') {
        continue;
      }
      return k;
    }
  }
  return -1;
}

/** `import type …` / `export type … from` 여부(기본 가져오기 이름이 type인 경우는 제외). */
function isTypeOnly(tokens, startIdx) {
  const a = tokens[startIdx + 1];
  const b = tokens[startIdx + 2];
  return (
    a?.t === 'id' && a.v === 'type' && !(b && b.t === 'id' && b.v === 'from') && !(b && b.t === 'p' && b.v === ',')
  );
}

/**
 * 소스에서 import 지점을 뽑는다.
 * @returns {{spec: string|null, line: number, kind: string, typeOnly: boolean}[]}
 */
export function extractImports(src) {
  const { tokens: top } = tokenize(src);
  const tokens = [...deepTokens(top)];
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== 'id') {
      continue;
    }
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && prev.t === 'p' && prev.v === '.') {
      if (t.v === 'glob' && next?.v === '(' && isStr(tokens[i + 2])) {
        out.push({ spec: strVal(tokens[i + 2]), line: t.line, kind: 'glob', typeOnly: false });
      }
      continue;
    }
    if (t.v === 'from' && isStr(next)) {
      const start = statementStart(tokens, i);
      const isExport = start >= 0 && tokens[start].v === 'export';
      out.push({
        spec: strVal(next),
        line: next.line,
        kind: isExport ? 'export-from' : 'static',
        typeOnly: start >= 0 && isTypeOnly(tokens, start),
      });
    } else if (t.v === 'import' && isStr(next)) {
      out.push({ spec: strVal(next), line: next.line, kind: 'side-effect', typeOnly: false });
    } else if ((t.v === 'import' || t.v === 'require') && next?.t === 'p' && next.v === '(') {
      const { args } = callArgs(tokens, i + 1);
      if (args[0]?.length === 1 && isStr(args[0][0])) {
        out.push({
          spec: strVal(args[0][0]),
          line: t.line,
          kind: t.v === 'import' ? 'dynamic' : 'require',
          typeOnly: false,
        });
      } else {
        out.push({ spec: null, line: t.line, kind: `nonliteral-${t.v}`, typeOnly: false });
      }
    } else if (t.v === 'createRequire' && next?.t === 'p' && next.v === '(') {
      out.push({ spec: null, line: t.line, kind: 'create-require', typeOnly: false });
    }
  }
  return out;
}
