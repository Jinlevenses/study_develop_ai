// utr: UTR-<INT>.md 단위테스트결과서(TST §20.1). 순수 함수.
import { type BriefInfo, parseTestId, rangeContains, UNIT_DIR, UNIT_LABEL } from './ids.js';
import { document, formatDelta, formatPct, table } from './markdown.js';
import type { CaseResult } from './results.js';
import type { SourceTitle } from './titles.js';

/** istanbul json-summary: `total` + 파일 경로 키. */
export type CoverageSummary = Record<
  string,
  { lines?: { total?: number; covered?: number; pct?: number } } | undefined
>;

export interface UtrInput {
  int: string;
  header: string;
  results: CaseResult[];
  coverage: CoverageSummary | null;
  prevCoverage: CoverageSummary | null;
  determinism: { equal: boolean } | null;
  briefs: BriefInfo[];
  titles: SourceTitle[];
}

interface Lines {
  total: number;
  covered: number;
}

const norm = (p: string): string => p.replace(/\\/g, '/');

/** 단위 디렉터리의 라인 합계(파일 키에 `/<dir>/` 포함분). `domainOnly` = `/src/domain/` 포함분. */
export function unitLines(summary: CoverageSummary | null, unitDir: string, domainOnly: boolean): Lines | null {
  if (summary === null) {
    return null;
  }
  let total = 0;
  let covered = 0;
  let any = false;
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total' || value?.lines === undefined) {
      continue;
    }
    const k = norm(key);
    if (!k.includes(`/${unitDir}/`) && !k.startsWith(`${unitDir}/`)) {
      continue;
    }
    if (domainOnly && !k.includes('/src/domain/')) {
      continue;
    }
    total += value.lines.total ?? 0;
    covered += value.lines.covered ?? 0;
    any = true;
  }
  return any ? { total, covered } : null;
}

const pctOf = (l: Lines | null): number | null =>
  l === null ? null : l.total === 0 ? 100 : (l.covered / l.total) * 100;

export interface UnitRow {
  unit: string;
  cases: number;
  pass: number;
  fail: number;
  skip: number;
  domain: number | null;
  domainPrev: number | null;
  all: number | null;
}

/** UT 결과의 단위별 집계. */
export function unitRows(results: CaseResult[], cov: CoverageSummary | null, prev: CoverageSummary | null): UnitRow[] {
  const byUnit = new Map<string, UnitRow>();
  for (const c of results) {
    const t = c.id === null ? null : parseTestId(c.id);
    if (t?.kind !== 'UT' || t.unit === null) {
      continue;
    }
    const dir = UNIT_DIR[t.unit] ?? '';
    const row =
      byUnit.get(t.unit) ??
      ({
        unit: t.unit,
        cases: 0,
        pass: 0,
        fail: 0,
        skip: 0,
        domain: pctOf(unitLines(cov, dir, true)),
        domainPrev: pctOf(unitLines(prev, dir, true)),
        all: pctOf(unitLines(cov, dir, false)),
      } satisfies UnitRow);
    row.cases++;
    row[c.status]++;
    byUnit.set(t.unit, row);
  }
  return [...byUnit.values()].sort((a, b) => (a.unit < b.unit ? -1 : 1));
}

function gateRow(rows: UnitRow[], coverage: CoverageSummary | null): string[] {
  const withDomain = rows.filter((r) => r.domain !== null && UNIT_DIR[r.unit]?.startsWith('services/'));
  if (coverage === null || withDomain.length === 0) {
    return ['services/*/src/domain', '≥ 80%, 감소 ≤ 2%p', 'n/a (coverage-summary.json 없음)', 'n/a'];
  }
  const min = Math.min(...withDomain.map((r) => r.domain ?? 100));
  const drops = withDomain.filter((r) => r.domainPrev !== null).map((r) => (r.domainPrev ?? 0) - (r.domain ?? 0));
  const maxDrop = drops.length > 0 ? Math.max(...drops) : 0;
  const ok = min >= 80 && maxDrop <= 2;
  return ['services/*/src/domain', '≥ 80%, 감소 ≤ 2%p', `최저 ${formatPct(min)}`, ok ? 'PASS' : 'FAIL'];
}

export function renderUtr(input: UtrInput): string {
  const rows = unitRows(input.results, input.coverage, input.prevCoverage);
  const det = input.determinism === null ? 'n/a' : input.determinism.equal ? '일치' : '불일치';
  const total = input.coverage?.total?.lines?.pct;
  const unitTable = table(
    ['단위', '케이스', '통과', '실패', '건너뜀', 'domain 라인(직전 대비)', '전체 라인'],
    rows.map((r) => [
      `${UNIT_LABEL[r.unit] ?? r.unit} (${r.unit})`,
      r.cases,
      r.pass,
      r.fail,
      r.skip,
      r.domain === null
        ? 'n/a'
        : `${formatPct(r.domain)}${formatDelta(r.domainPrev === null ? null : r.domain - r.domainPrev)}`,
      formatPct(r.all),
    ]),
  );
  const problems = input.results
    .filter((c) => c.id?.startsWith('UT-') === true && c.status !== 'pass')
    .sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1));
  const mapping = input.titles
    .filter((t) => t.test.kind === 'UT')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => [
      t.id,
      t.reqs.length > 0 ? t.reqs.join(', ') : t.validRefs.join(', '),
      input.briefs
        .filter((b) => b.ranges.some((r) => rangeContains(r, t.test)))
        .map((b) => b.taskId)
        .join(', ') || '—',
    ]);
  return document([
    `# UTR-${input.int} 단위테스트결과서 (자동 생성)`,
    `${input.header} · 결정성 2회: ${det}`,
    '',
    rows.length === 0 ? '단위 테스트 결과 없음(입력 0건).' : unitTable,
    '',
    typeof total === 'number' ? `전체 라인(total.lines.pct): ${formatPct(total)}` : '전체 라인(total.lines.pct): n/a',
    '',
    '## 커버리지 게이트',
    table(['단위', '기준', '결과', '판정'], [gateRow(rows, input.coverage)]),
    '',
    '## 실패 · 건너뜀 상세 (사유 필수)',
    table(
      ['ID', '사유', '결함 ID'],
      problems.map((c) => [c.id, c.message ?? (c.status === 'skip' ? '건너뜀(사유 미기재)' : '(사유 미기재)'), '—']),
    ),
    '',
    '## 신규 케이스 → 요구 매핑 (RTM 반영)',
    table(['ID', '요구', 'Task'], mapping),
  ]);
}
