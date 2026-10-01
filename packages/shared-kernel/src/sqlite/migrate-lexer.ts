// DB-01 §11.1 금지 토큰 렉서 [Brief 결정 §4.1.4]. 주석·문자열·인용 식별자를 걷어낸 토큰열에서
//  ① 최상위 문장의 첫 키워드가 트랜잭션·PRAGMA류이면 ② 어디서든 단독 토큰 PRAGMA·ATTACH·DETACH·VACUUM·load_extension이면 위반.
// `CREATE TRIGGER … BEGIN … END;` 안의 BEGIN·END·CASE는 깊이로 추적해 한 문장으로 본다. 순수 모듈(fs·SQLite 의존 0).

export type LexViolation = {
  readonly token: string;
  readonly line: number;
  readonly reason: 'forbidden' | 'unterminated';
};

type Token = { readonly kind: 'word' | 'punct'; readonly text: string; readonly line: number };

const FIRST_KEYWORD_FORBIDDEN: ReadonlySet<string> = new Set([
  'BEGIN',
  'COMMIT',
  'END',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'PRAGMA',
  'ATTACH',
  'DETACH',
  'VACUUM',
]);
const ANYWHERE_FORBIDDEN: ReadonlySet<string> = new Set(['PRAGMA', 'ATTACH', 'DETACH', 'VACUUM', 'LOAD_EXTENSION']);

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_$]/;

type LexOutcome = { readonly tokens: Token[]; readonly unterminatedAt: number | null };

function tokenize(sql: string): LexOutcome {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = sql.length;

  /** `quote`로 닫히는 구간을 건너뛴다(`''`·`""` 이스케이프 포함). 못 닫으면 false. */
  function skipQuoted(quote: string): boolean {
    i += 1;
    while (i < n) {
      const c = sql.charAt(i);
      if (c === '\n') {
        line += 1;
      }
      if (c === quote) {
        if (sql.charAt(i + 1) === quote) {
          i += 2;
          continue;
        }
        i += 1;
        return true;
      }
      i += 1;
    }
    return false;
  }

  while (i < n) {
    const c = sql.charAt(i);
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i += 1;
    } else if (c === '-' && sql.charAt(i + 1) === '-') {
      while (i < n && sql.charAt(i) !== '\n') {
        i += 1;
      }
    } else if (c === '/' && sql.charAt(i + 1) === '*') {
      const startLine = line;
      i += 2;
      let closed = false;
      while (i < n) {
        if (sql.charAt(i) === '*' && sql.charAt(i + 1) === '/') {
          i += 2;
          closed = true;
          break;
        }
        if (sql.charAt(i) === '\n') {
          line += 1;
        }
        i += 1;
      }
      if (!closed) {
        return { tokens, unterminatedAt: startLine };
      }
    } else if (c === "'" || c === '"' || c === '`') {
      const startLine = line;
      if (!skipQuoted(c)) {
        return { tokens, unterminatedAt: startLine };
      }
      tokens.push({ kind: 'word', text: '', line: startLine }); // 인용 요소 자리표시자(빈 텍스트 = 키워드 아님)
    } else if (c === '[') {
      const startLine = line;
      const close = sql.indexOf(']', i + 1);
      if (close < 0) {
        return { tokens, unterminatedAt: startLine };
      }
      for (let k = i; k < close; k += 1) {
        if (sql.charAt(k) === '\n') {
          line += 1;
        }
      }
      i = close + 1;
      tokens.push({ kind: 'word', text: '', line: startLine });
    } else if (WORD_START.test(c)) {
      const start = i;
      while (i < n && WORD_PART.test(sql.charAt(i))) {
        i += 1;
      }
      tokens.push({ kind: 'word', text: sql.slice(start, i), line });
    } else if (c >= '0' && c <= '9') {
      const start = i;
      while (i < n && /[0-9A-Za-z_.]/.test(sql.charAt(i))) {
        i += 1;
      }
      tokens.push({ kind: 'word', text: sql.slice(start, i), line });
    } else {
      tokens.push({ kind: 'punct', text: c, line });
      i += 1;
    }
  }
  return { tokens, unterminatedAt: null };
}

/** 위반이 없으면 null, 있으면 첫 위반(토큰·줄). */
export function findForbiddenToken(sql: string): LexViolation | null {
  const { tokens, unterminatedAt } = tokenize(sql);

  let statementStart = true;
  let isTrigger = false;
  let depth = 0;
  const statementWords: string[] = [];

  for (const tok of tokens) {
    const upper = tok.kind === 'word' ? tok.text.toUpperCase() : '';
    if (tok.kind === 'word' && upper !== '' && ANYWHERE_FORBIDDEN.has(upper)) {
      return { token: tok.text, line: tok.line, reason: 'forbidden' };
    }
    if (tok.kind === 'punct' && tok.text === ';' && depth === 0) {
      statementStart = true;
      isTrigger = false;
      statementWords.length = 0;
      continue;
    }
    if (statementStart && !(tok.kind === 'punct' && tok.text === ';')) {
      statementStart = false;
      if (upper !== '' && FIRST_KEYWORD_FORBIDDEN.has(upper)) {
        return { token: tok.text, line: tok.line, reason: 'forbidden' };
      }
    }
    if (tok.kind === 'word' && tok.text !== '') {
      if (statementWords.length < 3) {
        statementWords.push(upper);
        const [w0, w1, w2] = statementWords;
        if (w0 === 'CREATE' && (w1 === 'TRIGGER' || ((w1 === 'TEMP' || w1 === 'TEMPORARY') && w2 === 'TRIGGER'))) {
          isTrigger = true;
        }
      }
      if (isTrigger) {
        if (upper === 'BEGIN' || upper === 'CASE') {
          depth += 1;
        } else if (upper === 'END') {
          depth = Math.max(0, depth - 1);
        }
      }
    }
  }
  if (unterminatedAt !== null) {
    return { token: 'unterminated comment or quote', line: unterminatedAt, reason: 'unterminated' };
  }
  return null;
}
