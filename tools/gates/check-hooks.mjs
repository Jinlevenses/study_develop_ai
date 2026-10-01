#!/usr/bin/env node
// lint:hooks (DR-020, DB-01 §3.5·§3.6, E0-5) — 확장 훅 이름 열·ext 열이 마이그레이션 DDL에 실제로 있는지 검사.
//   입력 ① packages/contracts/src/db-hooks.ts(DB_NAME_HOOKS·DB_EXT_HOOKS·DB_EXT_TABLES — 리터럴만) ② 마이그레이션 .sql
//   hooks/file-missing · table-missing · name-missing · ext-missing · ext-shape
// 사용: node tools/gates/check-hooks.mjs [--root <dir>] [--json] [--quiet]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { matchClose, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const HOOKS_FILE = 'packages/contracts/src/db-hooks.ts';
const SHARED_DIR = 'packages/shared-kernel/infra-migrations';
/** DB → 마이그레이션 디렉터리(고정 표, Brief §4.4.3). */
const DB_DIRS = {
  'content.db': 'services/content/migrations',
  'learning.db': 'services/learning/migrations',
  'insight.db': 'services/learning/migrations-insight',
  'ai.db': 'services/ai-gateway/migrations',
  'ai-cache.db': 'services/ai-gateway/migrations-cache',
  'ops.db': 'services/ops/migrations',
};
const SQL_INCLUDE = [
  'services/*/migrations/**',
  'services/*/migrations-insight/**',
  'services/*/migrations-cache/**',
  `${SHARED_DIR}/**`,
];
const CONSTRAINT_WORDS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);
const EXT_DEF = "EXT TEXT NOT NULL DEFAULT '{}'";
const EXT_V_DEF = 'EXT_V INTEGER NOT NULL DEFAULT 1';

// ---------------------------------------------------------------- db-hooks.ts 리터럴 해석기
const literalOnly = (what) =>
  new GateEngineError('engine/input-missing', `${HOOKS_FILE} must be literal-only (${what}) — T-00-02 Brief §4.6`);

/** 토큰 열에서 리터럴(문자열·숫자·배열·객체)을 평가한다. 반환 노드: {k:'str'|'num'|'arr'|'obj', v|items|props, line}. */
function parseValue(tokens, i) {
  const t = tokens[i];
  if (t === undefined) {
    throw literalOnly('unexpected end');
  }
  let node;
  let next = i + 1;
  if (t.t === 'str') {
    node = { k: 'str', v: t.v, line: t.line };
  } else if (t.t === 'tpl' && t.exprs.length === 0) {
    node = { k: 'str', v: t.quasis[0].v, line: t.line };
  } else if (t.t === 'num') {
    node = { k: 'num', v: Number(t.v), line: t.line };
  } else if (t.t === 'p' && t.v === '[') {
    const items = [];
    let k = i + 1;
    while (!(tokens[k]?.t === 'p' && tokens[k].v === ']')) {
      if (k >= tokens.length) {
        throw literalOnly('unterminated array');
      }
      const r = parseValue(tokens, k);
      items.push(r.node);
      k = r.next;
      if (tokens[k]?.t === 'p' && tokens[k].v === ',') {
        k++;
      } else if (!(tokens[k]?.t === 'p' && tokens[k].v === ']')) {
        throw literalOnly(`unexpected token "${tokens[k]?.v}" in array (line ${tokens[k]?.line})`);
      }
    }
    node = { k: 'arr', items, line: t.line };
    next = k + 1;
  } else if (t.t === 'p' && t.v === '{') {
    const props = new Map();
    let k = i + 1;
    while (!(tokens[k]?.t === 'p' && tokens[k].v === '}')) {
      const key = tokens[k];
      if (key === undefined) {
        throw literalOnly('unterminated object');
      }
      if (!(key.t === 'id' || key.t === 'str') || !(tokens[k + 1]?.t === 'p' && tokens[k + 1].v === ':')) {
        throw literalOnly(`non-literal property at line ${key.line}`);
      }
      const r = parseValue(tokens, k + 2);
      props.set(key.v, r.node);
      k = r.next;
      if (tokens[k]?.t === 'p' && tokens[k].v === ',') {
        k++;
      } else if (!(tokens[k]?.t === 'p' && tokens[k].v === '}')) {
        throw literalOnly(`unexpected token "${tokens[k]?.v}" in object (line ${tokens[k]?.line})`);
      }
    }
    node = { k: 'obj', props, line: t.line };
    next = k + 1;
  } else {
    throw literalOnly(`"${t.v}" at line ${t.line}`);
  }
  // 값 뒤의 `as const`
  if (tokens[next]?.t === 'id' && tokens[next].v === 'as' && tokens[next + 1]?.v === 'const') {
    next += 2;
  }
  return { node, next };
}

/** `NAME = [ … ]`의 배열 리터럴 노드. 없으면 engine/input-missing. */
function readConst(tokens, name) {
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].t === 'id' && tokens[i].v === name && tokens[i + 1].t === 'p' && tokens[i + 1].v === '=') {
      const open = i + 2;
      if (!(tokens[open]?.t === 'p' && tokens[open].v === '[')) {
        throw literalOnly(`${name} is not an array literal`);
      }
      const close = matchClose(tokens, open);
      if (close >= tokens.length) {
        throw literalOnly(`${name} is unterminated`);
      }
      const r = parseValue(tokens, open);
      // 배열 뒤는 `as const`·`satisfies <Type>` 정도만 허용하므로 r.next 이후는 보지 않는다
      return r.node;
    }
  }
  throw new GateEngineError('engine/input-missing', `${HOOKS_FILE}: ${name} not found`);
}

const strOf = (node, what) => {
  if (node?.k !== 'str') {
    throw new GateEngineError('engine/input-missing', `${HOOKS_FILE}: ${what} must be a string literal`);
  }
  return node;
};
const arrOf = (node, what) => {
  if (node?.k !== 'arr') {
    throw new GateEngineError('engine/input-missing', `${HOOKS_FILE}: ${what} must be an array literal`);
  }
  return node.items;
};
const objOf = (node, what) => {
  if (node?.k !== 'obj') {
    throw new GateEngineError('engine/input-missing', `${HOOKS_FILE}: ${what} must be an object literal`);
  }
  return node.props;
};

export function parseHooks(src) {
  const { tokens } = tokenize(src);
  const nameHooks = arrOf(readConst(tokens, 'DB_NAME_HOOKS'), 'DB_NAME_HOOKS').map((n, i) => {
    const p = objOf(n, `DB_NAME_HOOKS[${i}]`);
    return {
      hook: strOf(p.get('hook'), `DB_NAME_HOOKS[${i}].hook`).v,
      table: strOf(p.get('table'), `DB_NAME_HOOKS[${i}].table`),
      file: strOf(p.get('file'), `DB_NAME_HOOKS[${i}].file`),
      columns: arrOf(p.get('columns'), `DB_NAME_HOOKS[${i}].columns`).map((c) => strOf(c, 'column')),
    };
  });
  // DB_EXT_HOOKS: 형식만(배열·문자열)
  for (const [i, n] of arrOf(readConst(tokens, 'DB_EXT_HOOKS'), 'DB_EXT_HOOKS').entries()) {
    const p = objOf(n, `DB_EXT_HOOKS[${i}]`);
    strOf(p.get('hook'), `DB_EXT_HOOKS[${i}].hook`);
    strOf(p.get('deferred'), `DB_EXT_HOOKS[${i}].deferred`);
    for (const k of ['tables', 'keys']) {
      arrOf(p.get(k), `DB_EXT_HOOKS[${i}].${k}`).forEach((s) => {
        strOf(s, `DB_EXT_HOOKS[${i}].${k}[]`);
      });
    }
  }
  const extTables = arrOf(readConst(tokens, 'DB_EXT_TABLES'), 'DB_EXT_TABLES').map((n, i) => {
    const p = objOf(n, `DB_EXT_TABLES[${i}]`);
    return {
      db: strOf(p.get('db'), `DB_EXT_TABLES[${i}].db`).v,
      table: strOf(p.get('table'), `DB_EXT_TABLES[${i}].table`),
    };
  });
  return { nameHooks, extTables };
}

// ---------------------------------------------------------------- DDL 해석
/** SQL 주석(줄 주석·블록 주석) 제거 — 문자열은 보존, 줄바꿈 유지. */
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j < 0 ? sql.length : j + 2;
      out += sql.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** 짝 괄호의 닫는 위치(문자열 인식). `open`은 여는 괄호 인덱스. */
function closeParen(sql, open) {
  let d = 0;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) {
        j += sql[j] === c ? 2 : 1;
      }
      i = j;
    } else if (c === '(') {
      d++;
    } else if (c === ')') {
      d--;
      if (d === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** 최상위 쉼표 분할(문자열·괄호 인식). */
function splitTop(body) {
  const parts = [];
  let cur = '';
  let d = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < body.length && !(body[j] === c && body[j + 1] !== c)) {
        j += body[j] === c ? 2 : 1;
      }
      cur += body.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') {
      d++;
    } else if (c === ')') {
      d--;
    }
    if (c === ',' && d === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '') {
    parts.push(cur);
  }
  return parts;
}

const unquote = (s) => s.replace(/^["'`[]|["'`\]]$/g, '');
const normDef = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/** SQL 한 파일 → {tables: Map(name → {line, cols: Map(col → def), constraints: string[]}), alters: [{table, col, def, line}]}. */
export function parseDdl(sqlText) {
  const sql = stripSqlComments(sqlText);
  const lineAt = (pos) => sql.slice(0, pos).split('\n').length;
  const tables = new Map();
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)["`\]]?\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(sql, open);
    if (close < 0) {
      continue;
    }
    const entry = { line: lineAt(m.index), cols: new Map(), constraints: [] };
    for (const raw of splitTop(sql.slice(open + 1, close))) {
      const def = raw.trim();
      if (def === '') {
        continue;
      }
      const first = unquote(def.split(/\s+/)[0]);
      if (CONSTRAINT_WORDS.has(first.toUpperCase())) {
        entry.constraints.push(def);
      } else {
        entry.cols.set(first, def.slice(def.search(/\s/) < 0 ? def.length : def.search(/\s/)).trim());
      }
    }
    tables.set(m[1], entry);
  }
  const alters = [];
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+["`[]?(\w+)["`\]]?\s+ADD\s+(?:COLUMN\s+)?["`[]?(\w+)["`\]]?\s+([^;]*)/gi,
  )) {
    alters.push({ table: m[1], col: m[2], def: m[3].trim(), line: lineAt(m.index) });
  }
  return { tables, alters };
}

export function analyze(root) {
  const hooksAbs = path.join(root, HOOKS_FILE);
  if (!existsSync(hooksAbs)) {
    throw new GateEngineError('engine/input-missing', `${HOOKS_FILE} not found`);
  }
  const hooks = parseHooks(readFileSync(hooksAbs, 'utf8'));
  const sqlFiles = walk(root, { exts: ['.sql'], include: SQL_INCLUDE });
  if (sqlFiles.length === 0) {
    throw new GateEngineError('engine/input-missing', 'no migration .sql files found');
  }
  const parsed = new Map(sqlFiles.map((f) => [f, parseDdl(readFileSync(path.join(root, f), 'utf8'))]));
  const dbOfFile = (f) => {
    for (const [db, dir] of Object.entries(DB_DIRS)) {
      if (f.startsWith(`${dir}/`)) {
        return db;
      }
    }
    return null;
  };
  /** DB의 검색 대상 파일(자기 디렉터리 + 공통 infra-migrations). */
  const filesOfDb = (db) =>
    sqlFiles.filter(
      (f) => (DB_DIRS[db] !== undefined && f.startsWith(`${DB_DIRS[db]}/`)) || f.startsWith(`${SHARED_DIR}/`),
    );

  const violations = [];
  const add = (file, line, rule, message) => violations.push({ file, line, rule, message, severity: 'error' });

  // 이름 훅
  for (const h of hooks.nameHooks) {
    const file = h.file.v;
    if (!sqlFiles.includes(file) && !existsSync(path.join(root, file))) {
      add(HOOKS_FILE, h.file.line, 'hooks/file-missing', `hook "${h.hook}": ${file} does not exist`);
      continue;
    }
    const here = parsed.get(file);
    const entry = here?.tables.get(h.table.v);
    if (!entry) {
      add(file, 1, 'hooks/table-missing', `hook "${h.hook}": table ${h.table.v} is not created in ${file}`);
      continue;
    }
    const db = dbOfFile(file);
    const extra = new Set(
      (db ? filesOfDb(db) : [file]).flatMap((f) =>
        parsed
          .get(f)
          .alters.filter((a) => a.table === h.table.v)
          .map((a) => a.col),
      ),
    );
    for (const c of h.columns) {
      if (!entry.cols.has(c.v) && !extra.has(c.v)) {
        add(file, entry.line, 'hooks/name-missing', `hook "${h.hook}": column ${h.table.v}.${c.v} is missing`);
      }
    }
  }

  // ext 훅 테이블
  for (const e of hooks.extTables) {
    const dbFiles = filesOfDb(e.db);
    let found = null;
    let foundFile = null;
    for (const f of dbFiles) {
      const t = parsed.get(f).tables.get(e.table.v);
      if (t) {
        found = t;
        foundFile = f;
        break;
      }
    }
    if (!found) {
      add(HOOKS_FILE, e.table.line, 'hooks/table-missing', `ext table ${e.table.v} not found in ${e.db} migrations`);
      continue;
    }
    const alters = dbFiles.flatMap((f) => parsed.get(f).alters.filter((a) => a.table === e.table.v));
    const def = (col) => found.cols.get(col) ?? alters.find((a) => a.col === col)?.def;
    const extDef = def('ext');
    const extVDef = def('ext_v');
    if (extDef === undefined) {
      add(foundFile, found.line, 'hooks/ext-missing', `${e.table.v} has no ext column (DB-01 §3.5)`);
    }
    if (extVDef === undefined) {
      add(foundFile, found.line, 'hooks/ext-missing', `${e.table.v} has no ext_v column (DB-01 §3.5)`);
    }
    if (extDef !== undefined) {
      const jsonValid = (s) => /JSON_VALID\s*\(\s*EXT\s*\)/i.test(s);
      const hasCheck = jsonValid(extDef) || found.constraints.some(jsonValid);
      const bare = normDef(`ext ${extDef}`.replace(/CHECK\s*\(\s*json_valid\s*\(\s*ext\s*\)\s*\)/gi, ''));
      if (bare !== EXT_DEF) {
        add(
          foundFile,
          found.line,
          'hooks/ext-shape',
          `${e.table.v}.ext must be \`ext TEXT NOT NULL DEFAULT '{}'\` (found: ${bare.toLowerCase()})`,
        );
      }
      if (!hasCheck) {
        add(foundFile, found.line, 'hooks/ext-shape', `${e.table.v}.ext lacks CHECK (json_valid(ext))`);
      }
    }
    if (extVDef !== undefined && normDef(`ext_v ${extVDef}`) !== EXT_V_DEF) {
      add(foundFile, found.line, 'hooks/ext-shape', `${e.table.v}.ext_v must be \`ext_v INTEGER NOT NULL DEFAULT 1\``);
    }
  }
  return { files: sqlFiles.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'lint:hooks', requireUnits: true, spec: {} }, (o) => analyze(o.root));
}
