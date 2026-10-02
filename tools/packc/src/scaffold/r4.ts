// R4 §5 표 파서(Brief T-01-03 §4.7). `### 5.<n> \`<track>\`` 절 안의 6열 표 행(`| id | 개념 | L | K | 층 | 선수 |`)을 읽는다.
// 입력 파손(0행·id/트랙 불일치·중복·선수 미존재·L/K/층 위반) = err → exit 2.
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

export type R4Row = {
  readonly id: string;
  readonly track: string;
  readonly titleKo: string;
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly primary: 'D' | 'C' | 'P' | 'S';
  readonly secondary: readonly ('D' | 'C' | 'P' | 'S')[];
  readonly layer: '이·코·핵' | '이·사·핵' | '이·핵';
  readonly prereqs: readonly string[];
};

export type R4Table = { readonly rows: readonly R4Row[]; readonly edges: number };

const SECTION_RE = /^### 5\.\d+ `([a-z0-9]+)`/;
const ID_RE = /^[a-z0-9]+\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LAYERS: readonly string[] = ['이·코·핵', '이·사·핵', '이·핵'];
const KINDS = ['D', 'C', 'P', 'S'] as const;
type Kind = (typeof KINDS)[number];

function kindOf(s: string): Kind | null {
  for (const k of KINDS) {
    if (k === s) {
      return k;
    }
  }
  return null;
}

function levelOf(s: string): 1 | 2 | 3 | 4 | 5 | null {
  switch (s) {
    case 'L1':
      return 1;
    case 'L2':
      return 2;
    case 'L3':
      return 3;
    case 'L4':
      return 4;
    case 'L5':
      return 5;
    default:
      return null;
  }
}

function layerOf(s: string): R4Row['layer'] | null {
  if (s === '이·코·핵' || s === '이·사·핵' || s === '이·핵') {
    return s;
  }
  return null;
}

export function parseR4(text: string): Result<R4Table, string> {
  const rows: R4Row[] = [];
  const seen = new Set<string>();
  let track: string | null = null;
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n] ?? '';
    if (line.startsWith('#')) {
      track = SECTION_RE.exec(line)?.[1] ?? null;
      continue;
    }
    if (track === null || !line.startsWith('|')) {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const id = cells[0] ?? '';
    if (!/^[a-z0-9]+\./.test(id)) {
      continue; // 헤더·구분선·다른 표
    }
    const where = `R4 line ${n + 1} (${id})`;
    if (cells.length !== 6) {
      return err(`${where}: expected 6 columns, found ${cells.length}`);
    }
    if (!ID_RE.test(id)) {
      return err(`${where}: invalid concept id`);
    }
    if (id.split('.')[0] !== track) {
      return err(`${where}: id namespace does not match section track '${track}'`);
    }
    if (seen.has(id)) {
      return err(`${where}: duplicate id`);
    }
    seen.add(id);
    const level = levelOf(cells[2] ?? '');
    if (level === null) {
      return err(`${where}: L must be L1..L5 (found '${cells[2] ?? ''}')`);
    }
    const kParts = (cells[3] ?? '').split('/');
    const primary = kParts.length <= 2 ? kindOf(kParts[0] ?? '') : null;
    const second = kParts.length === 2 ? kindOf(kParts[1] ?? '') : null;
    if (primary === null || (kParts.length === 2 && second === null)) {
      return err(`${where}: K must be one of D, C, P, S or X/Y (found '${cells[3] ?? ''}')`);
    }
    const layer = layerOf(cells[4] ?? '');
    if (layer === null || !LAYERS.includes(layer)) {
      return err(`${where}: layer must be 이·코·핵, 이·사·핵 or 이·핵 (found '${cells[4] ?? ''}')`);
    }
    const preCell = cells[5] ?? '';
    const prereqs =
      preCell === '—' || preCell === ''
        ? []
        : preCell
            .split(',')
            .map((p) => p.replace(/\*\*/g, '').trim())
            .filter((p) => p !== '');
    rows.push({
      id,
      track,
      titleKo: cells[1] ?? '',
      level,
      primary,
      secondary: second === null ? [] : [second],
      layer,
      prereqs,
    });
  }
  if (rows.length === 0) {
    return err('R4 table yielded 0 concept rows');
  }
  let edges = 0;
  for (const r of rows) {
    for (const p of r.prereqs) {
      if (!seen.has(p)) {
        return err(`R4 ${r.id}: prerequisite '${p}' does not exist`);
      }
      edges += 1;
    }
  }
  return ok({ rows, edges });
}
