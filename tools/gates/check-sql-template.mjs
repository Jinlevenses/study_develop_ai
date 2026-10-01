#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-sql-template.mjs (audit-fixed: 예외·0파일 → exit 2(runGate), 탈출구 hasEscape(사유 필수·같은 줄/윗줄), 헬퍼·수신자 설정(config/sql.json), CR-60 4규칙 가산, sqlLiterals·normalizeSql 공유 헬퍼 export)
// check:sql (NFR-SEC-016, STD-SQL-04·05·06·15, CR-60) — 런타임에 조립된 SQL 텍스트를 `.prepare()`·`.exec()`에 넘기는 코드와 SQL 리터럴 정책.
//   sql/template-interp  `...${x}...`                           sql/concat  "..." + x | "...".concat(x)
//   sql/tainted-var      const q = <interp|concat>; q += ...     sql/dynamic-arg  증명할 수 없는 인자(매개변수·멤버·호출 결과)
//   sql/pragma · sql/deferred-begin · sql/like · sql/outbox-insert  (CR-60: 리터럴 내용 기준)
// 허용 형태(STD-SQL-06): 문자열 리터럴, `${}` 없는 템플릿, 리터럴+리터럴, `${ident(x)}`·`${placeholders(n)}`·`${sqlInt(n)}`, import한 UPPER_SNAKE 상수.
// 탈출구: 같은 줄·윗줄 `// sql-ok: <사유>` 또는 `// biome-ignore lint/plugin: <사유>`(사유 필수).
// 사용: node tools/gates/check-sql-template.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { srcFiles } from './check-security-scan.mjs';
import { hasEscape, isMain, readJsonc, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { matchAny } from './lib/glob.mjs';
import { callArgs, tokenize } from './lib/lex.mjs';

const REGEX_RECEIVER = /^(re|rx|regex|regexp|pattern|matcher|[A-Za-z0-9_]*(Re|RE|Regex|Regexp|Pattern|_RE|_REGEX))$/;
const OPERATOR_TOKENS = new Set(['+', '=', '(', ',', '?', ':', '&&', '||', '??', '.']);
const ESCAPE_TAGS = ['sql-ok', 'biome-ignore lint/plugin'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** config/sql.json 로드·검증(5개 SQL 게이트 공용). 부재·파싱 실패·version !== 1·필수 키 누락 → engine/config(exit 2). */
export function loadSqlConfig(configPath) {
  const p = configPath ?? fileURLToPath(new URL('./config/sql.json', import.meta.url));
  const cfg = readJsonc(p);
  const bad = (msg) => {
    throw new GateEngineError('engine/config', `${p}: ${msg}`);
  };
  if (!isObject(cfg)) {
    bad('root must be an object');
  }
  if (cfg.version !== 1) {
    bad(`version must be 1 (got ${JSON.stringify(cfg.version)})`);
  }
  for (const k of [
    'sanctioned_helpers',
    'pragma_allow',
    'begin_allow',
    'like_scope',
    'outbox_allow',
    'db_paths_exempt',
  ]) {
    if (!isStrArray(cfg[k])) {
      bad(`${k} must be a string array`);
    }
  }
  if (!isObject(cfg.receivers) || !isStrArray(cfg.receivers.types) || !isStrArray(cfg.receivers.methods)) {
    bad('receivers must be {types[], methods[]}');
  }
  if (!isObject(cfg.db_files) || Object.values(cfg.db_files).some((v) => typeof v !== 'string')) {
    bad('db_files must map file name to unit');
  }
  if (!isObject(cfg.ledger) || typeof cfg.ledger.table !== 'string' || typeof cfg.ledger.writer !== 'string') {
    bad('ledger must be {table, writer}');
  }
  const ci = cfg.content_ingest;
  if (
    !isObject(ci) ||
    !isStrArray(ci.serving_tables) ||
    !isStrArray(ci.writers) ||
    !isStrArray(ci.overlay_tables) ||
    !isStrArray(ci.overlay_writers)
  ) {
    bad('content_ingest must be {serving_tables[], writers[], overlay_tables[], overlay_writers[]}');
  }
  return cfg;
}

/** SQL 문자열 수집(공유 헬퍼): [{text, line}] — 문자열·템플릿 토큰 각각 + `+`로만 이어진 리터럴 사슬을 이어 붙인 것. */
export function sqlLiterals(tokens) {
  const out = [];
  // 토큰 텍스트는 이스케이프가 원문 그대로다: `\"`→`"`, `\n`→공백(SQL 비교용)
  const unescapeSql = (s) => s.replace(/\\([\s\S])/g, (_m, c) => (c === 'n' || c === 't' || c === 'r' ? ' ' : c));
  const textOf = (t) => unescapeSql(t.t === 'str' ? t.v : t.quasis.map((q) => q.v).join('?'));
  const rec = (list) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.t === 'tpl') {
        for (const ex of t.exprs) {
          rec(ex.tokens);
        }
      }
      if (t.t !== 'str' && t.t !== 'tpl') {
        continue;
      }
      out.push({ text: textOf(t), line: t.line });
      // 사슬: lit + lit (+ lit)* — 첫 토큰에서만 시작(앞이 `+`+리터럴이면 이미 사슬의 일부)
      const prevIsChain =
        list[i - 1]?.t === 'p' && list[i - 1].v === '+' && (list[i - 2]?.t === 'str' || list[i - 2]?.t === 'tpl');
      if (prevIsChain) {
        continue;
      }
      let joined = textOf(t);
      let k = i;
      let links = 0;
      while (
        list[k + 1]?.t === 'p' &&
        list[k + 1].v === '+' &&
        (list[k + 2]?.t === 'str' || list[k + 2]?.t === 'tpl')
      ) {
        joined += textOf(list[k + 2]);
        k += 2;
        links++;
      }
      if (links > 0) {
        out.push({ text: joined, line: t.line });
      }
    }
  };
  rec(tokens);
  return out;
}

/** 비교용 정규화: 공백 1칸·대문자. */
export function normalizeSql(text) {
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** depth-0 `+`로 분할. */
function splitPlus(toks) {
  const parts = [];
  let cur = [];
  let d = 0;
  for (const t of toks) {
    if (t.t === 'p' && '([{'.includes(t.v)) {
      d++;
    }
    if (t.t === 'p' && ')]}'.includes(t.v)) {
      d--;
    }
    if (d === 0 && t.t === 'p' && t.v === '+') {
      parts.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  parts.push(cur);
  return parts;
}

/** 표현식 분류: {kind: 'ok'|'interp'|'concat'|'ident'|'dynamic', line}. */
export function classify(toks, sanctioned) {
  if (!toks.length) {
    return { kind: 'ok', line: 0 };
  }
  const line = toks[0].line;
  const isSanctionedExpr = (ex) =>
    ex.tokens.length >= 3 && ex.tokens[0].t === 'id' && sanctioned.has(ex.tokens[0].v) && ex.tokens[1].v === '(';
  if (toks[0].v === '(' && toks[toks.length - 1].v === ')' && toks.length > 2) {
    return classify(toks.slice(1, -1), sanctioned);
  }
  // cond ? 'lit' : 'lit' → 두 가지가 ok일 때만 ok(조건은 SQL 텍스트가 아님)
  {
    let d = 0;
    let q = -1;
    let c = -1;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'p' && '([{'.includes(t.v)) {
        d++;
      } else if (t.t === 'p' && ')]}'.includes(t.v)) {
        d--;
      } else if (d === 0 && t.t === 'p' && t.v === '?' && q < 0) {
        q = k;
      } else if (d === 0 && t.t === 'p' && t.v === ':' && q >= 0 && c < 0) {
        c = k;
      }
    }
    if (q > 0 && c > q) {
      const a = classify(toks.slice(q + 1, c), sanctioned);
      const b = classify(toks.slice(c + 1), sanctioned);
      if (a.kind === 'ok' && b.kind === 'ok') {
        return { kind: 'ok', line };
      }
      return { kind: a.kind !== 'ok' ? a.kind : b.kind, line };
    }
  }
  const parts = splitPlus(toks);
  if (parts.length > 1) {
    const kinds = parts.map((p) => classify(p, sanctioned));
    if (kinds.every((k) => k.kind === 'ok')) {
      return { kind: 'ok', line };
    }
    return { kind: 'concat', line };
  }
  if (toks.length === 1) {
    const t = toks[0];
    if (t.t === 'str') {
      return { kind: 'ok', line };
    }
    if (t.t === 'tpl') {
      if (!t.exprs.length) {
        return { kind: 'ok', line };
      }
      return t.exprs.every(isSanctionedExpr) ? { kind: 'ok', line } : { kind: 'interp', line: t.line };
    }
    if (t.t === 'id') {
      return { kind: 'ident', name: t.v, line };
    }
    return { kind: 'dynamic', line };
  }
  // 'lit'.concat(x) / ('lit' + 'lit').concat(...)
  const di = toks.findIndex((t, k) => t.v === '.' && toks[k + 1]?.v === 'concat' && toks[k + 2]?.v === '(');
  if (di > 0 && classify(toks.slice(0, di), sanctioned).kind === 'ok') {
    const { args } = callArgs(toks, di + 2);
    return args.every((a) => classify(a, sanctioned).kind === 'ok') ? { kind: 'ok', line } : { kind: 'concat', line };
  }
  return { kind: 'dynamic', line };
}

/** 대입문(`=`·`+=` 토큰 인덱스)의 우변 토큰 조각. */
function rhsAfter(toks, eq) {
  const out = [];
  let d = 0;
  for (let k = eq + 1; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p' && '([{'.includes(t.v)) {
      d++;
    }
    if (t.t === 'p' && ')]}'.includes(t.v)) {
      if (d === 0) {
        break;
      }
      d--;
    }
    if (d === 0 && t.t === 'p' && t.v === ';') {
      break;
    }
    if (d === 0 && out.length) {
      const prev = out[out.length - 1];
      const startsNewStmt =
        t.line > prev.line &&
        !(prev.t === 'p' && OPERATOR_TOKENS.has(prev.v)) &&
        !(t.t === 'p' && OPERATOR_TOKENS.has(t.v));
      if (startsNewStmt) {
        break;
      }
    }
    out.push(t);
  }
  return out;
}

function findAssignments(tokens, name) {
  const res = [];
  for (let k = 0; k < tokens.length - 1; k++) {
    const t = tokens[k];
    if (t.t !== 'id' || t.v !== name) {
      continue;
    }
    if (tokens[k - 1]?.v === '.') {
      continue;
    }
    const n = tokens[k + 1];
    if (n?.t === 'p' && (n.v === '=' || n.v === '+=')) {
      res.push({ op: n.v, rhs: rhsAfter(tokens, k + 1) });
    }
  }
  return res;
}

function importedNames(tokens) {
  const set = new Set();
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].v === 'import' && tokens[k].t === 'id') {
      let j = k + 1;
      while (j < tokens.length && !(tokens[j].v === 'from' && tokens[j + 1]?.t === 'str')) {
        if (tokens[j].t === 'id') {
          set.add(tokens[j].v);
        }
        if (tokens[j].t === 'str') {
          break;
        }
        j++;
      }
    }
  }
  return set;
}

/** 정규식 리터럴·`new RegExp(`로 초기화된 이름(RegExp#exec 수신자 판정 보조, 같은 파일 안에서만). */
function regexBoundNames(tokens) {
  const names = new Set();
  for (let k = 0; k < tokens.length - 2; k++) {
    const t = tokens[k];
    const eq = tokens[k + 1];
    const rhs = tokens[k + 2];
    if (t.t !== 'id' || eq?.t !== 'p' || eq.v !== '=') {
      continue;
    }
    if (rhs?.t === 're' || (rhs?.t === 'id' && rhs.v === 'new' && tokens[k + 3]?.v === 'RegExp')) {
      names.add(t.v);
    }
  }
  return names;
}

/** `.prepare(`·`.exec(` 호출 판정(런타임 SQL 조립). */
function scanCalls(rel, src, tokens, cfg, push) {
  const sanctioned = new Set(cfg.sanctioned_helpers);
  const methods = new Set(cfg.receivers.methods);
  const imported = importedNames(tokens);
  const regexNames = regexBoundNames(tokens);
  const lines = src.split('\n');
  const escaped = (line) => ESCAPE_TAGS.some((tag) => hasEscape(lines, line, tag));
  const scan = (list) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.t === 'tpl') {
        for (const ex of t.exprs) {
          scan(ex.tokens);
        }
      }
      if (t.t !== 'id' || !methods.has(t.v)) {
        continue;
      }
      const dot = list[i - 1];
      if (dot?.t !== 'p' || (dot.v !== '.' && dot.v !== '?.') || list[i + 1]?.v !== '(') {
        continue;
      }
      const recv = list[i - 2];
      if (recv?.t === 're' || (recv?.t === 'id' && (REGEX_RECEIVER.test(recv.v) || regexNames.has(recv.v)))) {
        continue; // RegExp#exec
      }
      const { args } = callArgs(list, i + 1);
      const a = args[0];
      if (!a?.length) {
        continue;
      }
      const callLine = a[0].line;
      const c = classify(a, sanctioned);
      const which = t.v;
      if (c.kind === 'ok') {
        continue;
      }
      const callEscaped = escaped(t.line) || escaped(callLine);
      const add = (line, rule, message) => {
        if (!callEscaped && !escaped(line)) {
          push({ file: rel, line, rule, message });
        }
      };
      if (c.kind === 'interp') {
        add(
          c.line,
          'sql/template-interp',
          `.${which}() argument interpolates \${...} into SQL text; bind with ?/:name or wrap identifiers in ident()`,
        );
      } else if (c.kind === 'concat') {
        add(callLine, 'sql/concat', `.${which}() argument is built by string concatenation`);
      } else if (c.kind === 'ident') {
        const asg = findAssignments(list, c.name);
        if (!asg.length) {
          if (imported.has(c.name) && /^[A-Z][A-Z0-9_]*$/.test(c.name)) {
            continue; // import한 상수: 자기 모듈에서 검증
          }
          add(
            callLine,
            'sql/dynamic-arg',
            `.${which}(${c.name}): argument is not a provable constant (parameter/unknown). Use a literal or add "// sql-ok: <reason>"`,
          );
        } else {
          for (const s of asg) {
            const k = classify(s.rhs, sanctioned);
            if (k.kind === 'interp' || k.kind === 'concat') {
              add(
                s.rhs[0]?.line ?? callLine,
                'sql/tainted-var',
                `"${c.name}" is built with ${k.kind} and later passed to .${which}()`,
              );
            } else if (k.kind !== 'ok' && s.op === '=') {
              add(callLine, 'sql/dynamic-arg', `.${which}(${c.name}): assigned from a non-constant expression`);
            }
          }
        }
      } else {
        add(
          callLine,
          'sql/dynamic-arg',
          `.${which}() argument is a dynamic expression (call/member/array). Use a literal or add "// sql-ok: <reason>"`,
        );
      }
    }
  };
  scan(tokens);
}

/** CR-60 리터럴 규칙(pragma·deferred-begin·like·outbox-insert). */
function scanLiterals(rel, src, tokens, cfg, push) {
  const lines = src.split('\n');
  const escaped = (line) => ESCAPE_TAGS.some((tag) => hasEscape(lines, line, tag));
  const inScope = (globs) => matchAny(rel, globs);
  for (const { text, line } of sqlLiterals(tokens)) {
    const n = normalizeSql(text);
    const add = (rule, message) => {
      if (!escaped(line)) {
        push({ file: rel, line, rule, message });
      }
    };
    if (n.startsWith('PRAGMA ') && !inScope(cfg.pragma_allow)) {
      add('sql/pragma', 'PRAGMA outside packages/shared-kernel/src/sqlite/** (STD-SQL-04)');
    }
    if ((/^BEGIN( DEFERRED)?( TRANSACTION)?;?$/.test(n) || n.includes('BEGIN DEFERRED')) && !inScope(cfg.begin_allow)) {
      add('sql/deferred-begin', 'deferred BEGIN: use tx() (BEGIN IMMEDIATE) (STD-SQL-05)');
    }
    if (inScope(cfg.like_scope) && n.includes(' LIKE ') && (n.includes('SELECT') || n.includes('WHERE'))) {
      add('sql/like', 'LIKE in content queries: use the FTS5 search port (STD-SQL-15, CR-24)');
    }
    if (/INSERT (OR \w+ )?INTO "?OUTBOX\b/.test(n) && !inScope(cfg.outbox_allow)) {
      add('sql/outbox-insert', 'INSERT INTO outbox outside shared-kernel eventing: use appendEvent() (STD-SQL)');
    }
  }
}

/** 한 파일 검사. 반환 진단 배열(severity error). */
export function checkFile(rel, src, cfg) {
  const { tokens } = tokenize(src);
  const out = [];
  const push = (v) => out.push({ ...v, severity: 'error' });
  scanCalls(rel, src, tokens, cfg, push);
  scanLiterals(rel, src, tokens, cfg, push);
  return out;
}

export function analyze(root, opts = {}) {
  const cfg = loadSqlConfig(opts.config);
  const files = srcFiles(root);
  const violations = [];
  for (const f of files) {
    violations.push(...checkFile(f, readFileSync(path.join(root, f), 'utf8'), cfg));
  }
  return { files: files.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:sql', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
