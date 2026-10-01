// rtm-source: RTM-01(docs/02-design/09-rtm.md) 표 파서와 fr-iteration.json 덮어쓰기. 순수 함수.
import { INT_RE } from './ids.js';

export const INT_ORDER = ['INT-1a', 'INT-1b', 'INT-2', 'INT-3', 'INT-4', 'INT-5', 'INT-6', 'INT-7', 'PG-3'] as const;

export const isIntId = (s: string): boolean => INT_RE.test(s);

/** 순서 비교(-1·0·1). 알 수 없는 ID는 던진다. */
export function compareInt(a: string, b: string): number {
  const ia = (INT_ORDER as readonly string[]).indexOf(a);
  const ib = (INT_ORDER as readonly string[]).indexOf(b);
  if (ia < 0 || ib < 0) {
    throw new RangeError(`unknown INT id: ${ia < 0 ? a : b}`);
  }
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** 직전 INT(없으면 null). */
export function previousInt(id: string): string | null {
  const i = (INT_ORDER as readonly string[]).indexOf(id);
  return i > 0 ? (INT_ORDER[i - 1] ?? null) : null;
}

const RANGE_RE = /(INT-(?:1a|1b|[2-7])|PG-3)\s*[~∼]\s*(?:INT-)?(1a|1b|[2-7]|PG-3)/;
const SINGLE_RE = /INT-(?:1a|1b|[2-7])|PG-3/g;

/** 텍스트의 INT(범위는 상한). 'INT-2~3' → 'INT-3', 인식 불가 → null. */
export function intUpper(text: string): string | null {
  const range = RANGE_RE.exec(text);
  if (range?.[2] !== undefined) {
    const hi = range[2].startsWith('PG') ? range[2] : `INT-${range[2]}`;
    return isIntId(hi) ? hi : null;
  }
  let best: string | null = null;
  for (const m of text.matchAll(SINGLE_RE)) {
    if (best === null || compareInt(m[0], best) > 0) {
      best = m[0];
    }
  }
  return best;
}

export interface ReqRow {
  id: string;
  kind: 'FR' | 'NFR';
  name: string;
  priority: string;
  slice: string;
  /** RTM V 열 원문(`V-build`·`B+V-live` …). */
  v: string;
  /** INT 열 원문. */
  intText: string;
  first_int: string | null;
  deferred: boolean;
}

export class ShapeError extends Error {}

const REQ_ID_RE = /^(FR|NFR)-[A-Z]+-\d{3}$/;

/** 표 행 하나를 셀 배열로(`\|` 이스케이프 보존). */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i] ?? '';
    if (c === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** 머리 셀에 `ID`·`우선·슬`·`V`·`INT` 가 모두 있는 표의 요구 행을 모은다(열 위치는 머리 셀 텍스트로 찾는다). */
export function parseRtmTables(md: string): ReqRow[] {
  const lines = md.split(/\r?\n/);
  const rows: ReqRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trimStart().startsWith('|')) {
      continue;
    }
    const head = splitRow(line);
    const col = (name: string): number => head.indexOf(name);
    const cId = col('ID');
    const cPrio = col('우선·슬');
    const cV = col('V');
    const cInt = col('INT');
    if (cId < 0 || cPrio < 0 || cV < 0 || cInt < 0) {
      continue;
    }
    const cName = col('이름');
    let j = i + 1;
    if (/^\|\s*:?-{2,}/.test(lines[j] ?? '')) {
      j++;
    }
    for (; j < lines.length && (lines[j] ?? '').trimStart().startsWith('|'); j++) {
      const cells = splitRow(lines[j] ?? '');
      const id = cells[cId] ?? '';
      if (!REQ_ID_RE.test(id)) {
        continue;
      }
      const [priority = '', slice = ''] = (cells[cPrio] ?? '').split('·').map((s) => s.trim());
      const intText = cells[cInt] ?? '';
      const first = intUpper(intText);
      rows.push({
        id,
        kind: id.startsWith('NFR') ? 'NFR' : 'FR',
        name: cName >= 0 ? (cells[cName] ?? '') : '',
        priority,
        slice,
        v: cells[cV] ?? '',
        intText,
        first_int: first,
        deferred: first === null,
      });
    }
    i = j - 1;
  }
  return rows;
}

export interface IterationEntry {
  first_int: string | null;
  deferred: boolean | undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function entry(raw: unknown, where: string): { id: string; e: IterationEntry } {
  if (!isObj(raw)) {
    throw new ShapeError(`${where}: entry must be an object`);
  }
  const id = raw.id ?? raw.req;
  const intRaw = raw.first_int ?? raw.int;
  if (typeof id !== 'string' || !REQ_ID_RE.test(id)) {
    throw new ShapeError(`${where}: entry needs an id|req like FR-AAA-001`);
  }
  const first = typeof intRaw === 'string' ? intUpper(intRaw) : null;
  if (intRaw !== undefined && typeof intRaw !== 'string') {
    throw new ShapeError(`${where}: first_int|int of ${id} must be a string`);
  }
  const deferred = raw.deferred;
  if (deferred !== undefined && typeof deferred !== 'boolean') {
    throw new ShapeError(`${where}: deferred of ${id} must be boolean`);
  }
  return { id, e: { first_int: first, deferred } };
}

/**
 * fr-iteration.json 관대한 읽기. 허용 모양: 루트 배열 · `{requirements: [...]}` ·
 * (T-00-01 시드 모양) `{assignments: {<id>: {first_int, ...}}}`. 그 밖 모양 → ShapeError.
 */
export function parseIteration(data: unknown): Map<string, IterationEntry> {
  const out = new Map<string, IterationEntry>();
  if (Array.isArray(data)) {
    data.forEach((raw, i) => {
      const { id, e } = entry(raw, `[${i}]`);
      out.set(id, e);
    });
    return out;
  }
  if (isObj(data) && Array.isArray(data.requirements)) {
    data.requirements.forEach((raw: unknown, i: number) => {
      const { id, e } = entry(raw, `requirements[${i}]`);
      out.set(id, e);
    });
    return out;
  }
  if (isObj(data) && isObj(data.assignments)) {
    for (const [id, raw] of Object.entries(data.assignments)) {
      if (!isObj(raw)) {
        throw new ShapeError(`assignments.${id}: entry must be an object`);
      }
      const { e } = entry({ ...raw, id }, `assignments.${id}`);
      out.set(id, e);
    }
    return out;
  }
  throw new ShapeError('fr-iteration.json: expected an array, {requirements: [...]} or {assignments: {...}}');
}

/** RTM 행에 fr-iteration 덮어쓰기(첫 판정 INT·deferred 가 우선). */
export function applyIteration(rows: ReqRow[], iteration: Map<string, IterationEntry>): ReqRow[] {
  return rows.map((r) => {
    const o = iteration.get(r.id);
    if (o === undefined) {
      return r;
    }
    const first = o.first_int ?? r.first_int;
    const deferred = o.deferred ?? (o.first_int !== null ? false : r.deferred);
    return { ...r, first_int: first, deferred: first === null ? true : deferred };
  });
}
