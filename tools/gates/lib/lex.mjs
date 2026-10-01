// ported-from: spikes/sp7-static-gates/src/lib/lex.mjs (audit-fixed: 동작 변경 0, 형식·린트 정리만 — SP-7 감사 A.2 6번 줄 수 정정)
// Minimal comment/string/template-aware tokenizer for TS/TSX/JS/CSS-ish sources.
// Purpose: static gates that must NOT depend on the TypeScript compiler API (TS 7 / tsgo has none in-process).
// Not a parser: no JSX awareness (recovers from stray apostrophes in JSX text), no type awareness.
//
// Token: { t: 'id'|'num'|'str'|'tpl'|'re'|'p', v, s, e, line }
//   str.v   = decoded-ish inner text (escapes kept raw)
//   tpl     = { quasis: [{v,s}], exprs: [{s,e,tokens}] }
//   comments are returned separately: { v, s, e, line, kind: 'line'|'block' }

const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const MULTI = [
  '...',
  '===',
  '!==',
  '**=',
  '??=',
  '||=',
  '&&=',
  '==',
  '!=',
  '<=',
  '>=',
  '=>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '||',
  '&&',
  '??',
  '?.',
  '++',
  '--',
  '**',
];

const isIdStart = (c) => /[A-Za-z_$#\u0080-￿]/.test(c);
const isIdPart = (c) => /[\w$\u0080-￿]/.test(c);

export function tokenize(src) {
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) {
    if (src.charCodeAt(k) === 10) {
      lineStarts.push(k + 1);
    }
  }
  const lineOf = (pos) => {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };
  const comments = [];

  // lex(from,to,stopAtBrace) -> { tokens, end }
  function lex(from, to, stopAtBrace) {
    const tokens = [];
    let i = from;
    let depth = 0;
    const prevSig = () => tokens[tokens.length - 1];
    while (i < to) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i++;
        continue;
      }
      // comments
      if (c === '/' && src[i + 1] === '/') {
        let j = i;
        while (j < to && src[j] !== '\n') {
          j++;
        }
        comments.push({ v: src.slice(i, j), s: i, e: j, line: lineOf(i), kind: 'line' });
        i = j;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        let j = src.indexOf('*/', i + 2);
        j = j < 0 ? to : j + 2;
        comments.push({ v: src.slice(i, j), s: i, e: j, line: lineOf(i), kind: 'block' });
        i = j;
        continue;
      }
      // strings
      if (c === '"' || c === "'") {
        let j = i + 1,
          ok = false;
        while (j < to) {
          const d = src[j];
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === c) {
            ok = true;
            break;
          }
          if (d === '\n') {
            break; // unterminated: JSX text apostrophe -> recover
          }
          j++;
        }
        if (!ok) {
          tokens.push({ t: 'p', v: c, s: i, e: i + 1, line: lineOf(i) });
          i++;
          continue;
        }
        tokens.push({ t: 'str', v: src.slice(i + 1, j), s: i, e: j + 1, line: lineOf(i) });
        i = j + 1;
        continue;
      }
      // template literal
      if (c === '`') {
        const quasis = [];
        const exprs = [];
        let j = i + 1,
          qs = j;
        while (j < to) {
          const d = src[j];
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '`') {
            break;
          }
          if (d === '$' && src[j + 1] === '{') {
            quasis.push({ v: src.slice(qs, j), s: qs });
            const inner = lex(j + 2, to, true);
            exprs.push({ s: j + 2, e: inner.end, tokens: inner.tokens });
            j = inner.end + 1;
            qs = j;
            continue;
          }
          j++;
        }
        quasis.push({ v: src.slice(qs, j), s: qs });
        tokens.push({ t: 'tpl', v: src.slice(i + 1, j), s: i, e: j + 1, line: lineOf(i), quasis, exprs });
        i = j + 1;
        continue;
      }
      // regex literal (heuristic)
      if (c === '/') {
        const p = prevSig();
        const regexOk =
          !p || (p.t === 'p' && ![')', ']', '}'].includes(p.v)) || (p.t === 'id' && KEYWORDS_BEFORE_REGEX.has(p.v));
        if (regexOk) {
          let j = i + 1,
            inClass = false,
            ok = false;
          while (j < to) {
            const d = src[j];
            if (d === '\\') {
              j += 2;
              continue;
            }
            if (d === '\n') {
              break;
            }
            if (d === '[') {
              inClass = true;
            } else if (d === ']') {
              inClass = false;
            } else if (d === '/' && !inClass) {
              ok = true;
              break;
            }
            j++;
          }
          if (ok) {
            j++;
            while (j < to && /[a-z]/i.test(src[j])) {
              j++;
            }
            tokens.push({ t: 're', v: src.slice(i, j), s: i, e: j, line: lineOf(i) });
            i = j;
            continue;
          }
        }
      }
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < to && isIdPart(src[j])) {
          j++;
        }
        tokens.push({ t: 'id', v: src.slice(i, j), s: i, e: j, line: lineOf(i) });
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < to && /[0-9A-Za-z_.]/.test(src[j])) {
          j++;
        }
        tokens.push({ t: 'num', v: src.slice(i, j), s: i, e: j, line: lineOf(i) });
        i = j;
        continue;
      }
      // punctuation
      if (stopAtBrace) {
        if (c === '{') {
          depth++;
        } else if (c === '}') {
          if (depth === 0) {
            return { tokens, end: i };
          }
          depth--;
        }
      }
      let op = c;
      for (const m of MULTI) {
        if (src.startsWith(m, i)) {
          op = m;
          break;
        }
      }
      tokens.push({ t: 'p', v: op, s: i, e: i + op.length, line: lineOf(i) });
      i += op.length;
    }
    return { tokens, end: i };
  }

  const { tokens } = lex(0, src.length, false);
  comments.sort((a, b) => a.s - b.s);
  return { tokens, comments, lineOf };
}

/** Source with comments replaced by spaces (offsets and newlines preserved). Strings/templates untouched. */
export function maskComments(src, comments) {
  let out = '',
    last = 0;
  for (const c of comments) {
    out += src.slice(last, c.s) + src.slice(c.s, c.e).replace(/[^\n]/g, ' ');
    last = c.e;
  }
  return out + src.slice(last);
}

/** Yield every str token and template quasi (text pieces of string-ish literals) with line numbers. */
export function* stringPieces(tokens, lineOf) {
  for (const t of tokens) {
    if (t.t === 'str') {
      yield { text: t.v, line: t.line, s: t.s };
    } else if (t.t === 'tpl') {
      for (const q of t.quasis) {
        yield { text: q.v, line: lineOf(q.s), s: q.s, tpl: true };
      }
      for (const ex of t.exprs) {
        yield* stringPieces(ex.tokens, lineOf);
      }
    }
  }
}

/** Recursively flatten tokens (template expression tokens inlined after their tpl token). */
export function* deepTokens(tokens) {
  for (const t of tokens) {
    yield t;
    if (t.t === 'tpl') {
      for (const ex of t.exprs) {
        yield* deepTokens(ex.tokens);
      }
    }
  }
}

/** Index of the token matching the opener at `i` ('(', '[', '{'). Returns tokens.length if unbalanced. */
export function matchClose(tokens, i) {
  const open = tokens[i].v;
  const close = { '(': ')', '[': ']', '{': '}' }[open];
  let d = 0;
  for (let k = i; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'p') {
      continue;
    }
    if (t.v === open) {
      d++;
    } else if (t.v === close) {
      d--;
      if (d === 0) {
        return k;
      }
    }
  }
  return tokens.length;
}

/** Split call arguments at top-level commas. `open` is the index of '('. */
export function callArgs(tokens, open) {
  const close = matchClose(tokens, open);
  const args = [];
  let cur = [];
  let d = 0;
  for (let k = open + 1; k < close; k++) {
    const t = tokens[k];
    if (t.t === 'p' && '([{'.includes(t.v)) {
      d++;
    }
    if (t.t === 'p' && ')]}'.includes(t.v)) {
      d--;
    }
    if (d === 0 && t.t === 'p' && t.v === ',') {
      args.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  if (cur.length) {
    args.push(cur);
  }
  return { args, close };
}
