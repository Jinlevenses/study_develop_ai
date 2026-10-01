// itr: ITR-<INT>.md 통합테스트결과서(TST §20.2) + run-gates --json 어댑터. 순수 함수.
import { parseTestId } from './ids.js';
import { document, formatDuration, table } from './markdown.js';
import type { PrfData } from './prf.js';
import { verdict } from './prf.js';
import type { CaseResult } from './results.js';

export interface GateRow {
  id: string;
  exit: number;
  errors: number;
  warnings: number;
  files: number;
  skipped?: string;
  error?: string;
}

export interface GatesJson {
  stage: string;
  exit: number;
  warn_only: boolean;
  gates: GateRow[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** run-gates `--json` 출력(`{stage, warn_only, exit, gates[]}`). 모양이 다르면 null. */
export function parseGatesJson(data: unknown): GatesJson | null {
  if (!isObj(data) || !Array.isArray(data.gates) || typeof data.exit !== 'number') {
    return null;
  }
  const gates: GateRow[] = [];
  for (const g of data.gates as unknown[]) {
    if (!isObj(g) || typeof g.id !== 'string' || typeof g.exit !== 'number') {
      return null;
    }
    gates.push({
      id: g.id,
      exit: g.exit,
      errors: typeof g.errors === 'number' ? g.errors : 0,
      warnings: typeof g.warnings === 'number' ? g.warnings : 0,
      files: typeof g.files === 'number' ? g.files : 0,
      ...(typeof g.skipped === 'string' ? { skipped: g.skipped } : {}),
      ...(typeof g.error === 'string' ? { error: g.error } : {}),
    });
  }
  return {
    stage: typeof data.stage === 'string' ? data.stage : '?',
    exit: data.exit,
    warn_only: data.warn_only === true,
    gates,
  };
}

export interface ItrInput {
  int: string;
  header: string;
  results: CaseResult[];
  prf: PrfData | null;
  gates: GatesJson | null;
  /** docs/40-impl/graph/<INT>/metrics.json 의 cross_service_edge_count. */
  crossServiceEdgeCount: number | null;
  egress: unknown;
  quarantine: unknown[] | null;
}

const SUITES: { label: string; prefix: string[] }[] = [
  { label: 'contract (CT · CT-SYS)', prefix: ['CT'] },
  { label: 'integration (IT)', prefix: ['IT'] },
  { label: 'security (SEC) 요약', prefix: ['SEC'] },
  { label: 'e2e (E2E)', prefix: ['E2E'] },
  { label: 'chaos (CHA)', prefix: ['CHA'] },
];

const kindOf = (c: CaseResult): string | null => (c.id === null ? null : (parseTestId(c.id)?.kind ?? null));
const statusWord = (c: CaseResult): string => (c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : 'SKIP');

function describeValue(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
}

function scenario(title: string): string {
  return title.replace(/^\S+\s+/, '').replace(/\s*(\[[^\]]+\])+\s*$/, '');
}

function pick(o: unknown, ...keys: string[]): string {
  if (!isObj(o)) {
    return '—';
  }
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null) {
      return describeValue(v);
    }
  }
  return '—';
}

export function renderItr(input: ItrInput): string {
  const suiteRows = SUITES.map((s) => {
    const cs = input.results.filter((c) => {
      const k = kindOf(c);
      return k !== null && s.prefix.includes(k);
    });
    const pass = cs.filter((c) => c.status === 'pass').length;
    const fail = cs.filter((c) => c.status === 'fail').length;
    const ms = cs.reduce((sum, c) => sum + c.durationMs, 0);
    return [
      s.label,
      `${pass}/${cs.length}`,
      '—',
      cs.length === 0 ? '—' : formatDuration(ms),
      cs.length === 0 ? 'n/a (결과 없음)' : fail > 0 ? 'FAIL' : 'PASS',
    ];
  });
  const prfRuns = input.prf?.runs ?? [];
  suiteRows.push([
    'perf 빠른 세트',
    `${prfRuns.filter((r) => verdict(r).pass).length}/${prfRuns.length}`,
    '—',
    '—',
    prfRuns.length === 0 ? 'n/a (prf.json 없음)' : prfRuns.every((r) => verdict(r).pass) ? 'PASS' : 'FAIL',
  ]);
  const caseRows = input.results
    .filter((c) => {
      const k = kindOf(c);
      return k === 'IT' || k === 'E2E' || k === 'CHA';
    })
    .sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1))
    .map((c) => [c.id, scenario(c.title), statusWord(c), formatDuration(c.durationMs), '—', c.message ?? '']);
  const egress = input.egress;
  const egressBody = isObj(egress)
    ? table(
        ['항목', '값'],
        Object.entries(egress).map(([k, v]) => [k, describeValue(v)]),
      )
    : 'n/a (egress.json 없음)';
  const quarantine = (input.quarantine ?? []).map((q) => [
    pick(q, 'id', 'test'),
    pick(q, 'defect_id', 'defect'),
    pick(q, 'since_int', 'since'),
    pick(q, 'release', 'until'),
  ]);
  const gateRows: (string | number)[][] = [];
  if (input.gates !== null) {
    gateRows.push([
      `check:gates --stage=${input.gates.stage}`,
      `exit ${input.gates.exit}`,
      input.gates.warn_only ? '--warn-only' : '',
    ]);
    for (const g of input.gates.gates) {
      gateRows.push([
        g.id,
        g.skipped ? `skipped(${g.skipped})` : g.exit === 0 ? 'PASS' : g.exit === 1 ? 'FAIL' : 'ERROR',
        g.error ?? `errors=${g.errors} warnings=${g.warnings} files=${g.files}`,
      ]);
    }
  } else {
    gateRows.push(['check:gates', 'n/a (gates.json 없음)', '']);
  }
  gateRows.push([
    'audit:graph',
    input.crossServiceEdgeCount === null
      ? 'n/a (metrics.json 없음)'
      : `교차 서비스 파일 엣지 ${input.crossServiceEdgeCount}`,
    '비차단',
  ]);
  return document([
    `# ITR-${input.int} 통합테스트결과서 (자동 생성)`,
    `${input.header} · 격리 수준: ${pick(egress, 'isolation', 'level', 'isolation_level')} · 브라우저: ${pick(egress, 'browser')}`,
    '',
    '## 1. 스위트 요약',
    table(['스위트', '통과/전체', '재시도', '소요', '판정'], suiteRows),
    '',
    '## 2. 케이스 결과',
    table(['ID', '시나리오', '결과', '소요', '결함 ID', '비고'], caseRows),
    '',
    '## 3. 외부 호출 0 (egress.json)',
    egressBody,
    '',
    '## 4. 격리(quarantine) 목록',
    table(['ID', '결함 ID', '격리 시작 INT', '해제 예정'], quarantine),
    '',
    '## 5. 정적 게이트 · 감사',
    table(['게이트', '결과', '비고'], gateRows),
    '',
    '## 6. 판정(T1): (T1 기입)',
  ]);
}
