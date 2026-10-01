// pgm: WBS-01 §17 프로그램목록(PGM-01) 표 ↔ 저장소 경로 대조(PGM-SID-003, STD-NAM-96). 순수 함수 — 파일 목록은 cli가 넘긴다.

import { expandBraces, globToRegExp } from './ids.js';
import { document, table } from './markdown.js';

export interface PgmRow {
  id: string;
  type: string;
  unit: string;
  /** 경로 열의 백틱 토큰(원문). */
  paths: string[];
  wp: string;
}

export type PgmState = 'exists' | 'partial' | 'missing';

export interface PgmResult {
  row: PgmRow;
  state: PgmState;
  missing: string[];
}

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

/** `| PGM-…` 행을 모은다(열 위치는 머리 셀 텍스트로: `PGM-ID`·`유형`·`단위`·`경로` 포함 셀·`WP`). */
export function parsePgmTables(md: string): PgmRow[] {
  const lines = md.split(/\r?\n/);
  const rows: PgmRow[] = [];
  let cols: { id: number; type: number; unit: number; path: number; wp: number } | null = null;
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) {
      cols = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.includes('PGM-ID')) {
      cols = {
        id: cells.indexOf('PGM-ID'),
        type: cells.indexOf('유형'),
        unit: cells.indexOf('단위'),
        path: cells.findIndex((c) => c.includes('경로')),
        wp: cells.indexOf('WP'),
      };
      continue;
    }
    const id = cells[cols?.id ?? 0] ?? '';
    if (cols === null || !/^PGM-[A-Z]+-\d{3}$/.test(id)) {
      continue;
    }
    const pathCell = cells[cols.path] ?? '';
    rows.push({
      id,
      type: cells[cols.type] ?? '',
      unit: cells[cols.unit] ?? '',
      paths: [...pathCell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? ''),
      wp: cells[cols.wp] ?? '',
    });
  }
  return rows;
}

const ROOTED_RE = /^(?:apps|services|packages|tools|tests|docs|content|policy|evals|deploy|\.github)\//;

/** 자리표시자 `<bc>`·`<…>` 를 `*` 로 바꾼다. */
export const placeholderToStar = (token: string): string => token.replace(/<[^>]*>/g, '*');

/** 상대 토큰(`infra/packs/**`)은 첫 루트 토큰의 `…/src/` 아래로 푼다. */
export function resolveTokens(tokens: string[]): string[] {
  const first = tokens.find((t) => ROOTED_RE.test(t));
  const base = first === undefined ? '' : (/^((?:apps|services|packages|tools)\/[^/]+\/src\/)/.exec(first)?.[1] ?? '');
  return tokens.map((t) => {
    const star = placeholderToStar(t);
    return !ROOTED_RE.test(star) && star.includes('/') && base !== '' ? `${base}${star}` : star;
  });
}

export interface FileIndex {
  /** 파일 경로와 그 모든 조상 디렉터리. */
  entries: string[];
}

export function buildFileIndex(files: string[]): FileIndex {
  const set = new Set<string>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i <= parts.length; i++) {
      set.add(parts.slice(0, i).join('/'));
    }
  }
  return { entries: [...set] };
}

function exists(index: FileIndex, pattern: string): boolean {
  const re = globToRegExp(pattern.replace(/\/+$/, ''));
  return index.entries.some((e) => re.test(e));
}

export function resolvePgm(row: PgmRow, index: FileIndex): PgmResult {
  // 중괄호 목록(`{a,b}`)은 항목마다 따로 확인한다: 일부만 있으면 partial.
  const patterns = resolveTokens(row.paths).flatMap(expandBraces);
  const missing = patterns.filter((p) => !exists(index, p));
  const state: PgmState =
    patterns.length === 0 || missing.length === patterns.length
      ? 'missing'
      : missing.length === 0
        ? 'exists'
        : 'partial';
  return { row, state, missing: missing.map((p) => p) };
}

export function renderPgm(int: string, header: string, results: PgmResult[]): string {
  const count = (s: PgmState): number => results.filter((r) => r.state === s).length;
  const partial = results.filter((r) => r.state === 'partial');
  return document([
    `# PGM-${int} 프로그램목록 대조 (자동 생성)`,
    header,
    '',
    table(
      ['PGM 수', 'exists', 'partial', 'missing'],
      [[results.length, count('exists'), count('partial'), count('missing')]],
    ),
    '',
    '보고 전용 — 차단하지 않는다(exit 0).',
    '',
    table(
      ['PGM-ID', 'WP', '경로', '상태'],
      results.map((r) => [r.row.id, r.row.wp, r.row.paths.join(', '), r.state]),
    ),
    '',
    '## 일부만 있는 항목(partial)의 누락 경로',
    partial.length === 0
      ? '없음'
      : table(
          ['PGM-ID', '누락 경로'],
          partial.map((r) => [r.row.id, r.missing.join(', ')]),
        ),
  ]);
}
