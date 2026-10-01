// sec: SEC-<INT>.md 보안약점 진단 결과(TST §20.4). §2~§4 는 T1 기입 자리. 순수 함수.
import { parseTestId, UNIT_LABEL } from './ids.js';
import type { GatesJson } from './itr.js';
import { document, table } from './markdown.js';
import type { CaseResult } from './results.js';

export interface SecInput {
  int: string;
  header: string;
  /** pnpm audit --json 출력(없으면 null). */
  audit: unknown;
  gates: GatesJson | null;
  results: CaseResult[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** audit.json `metadata.vulnerabilities` 의 high + critical 수. 모양이 다르면 null. */
export function auditHighCritical(audit: unknown): number | null {
  if (!isObj(audit) || !isObj(audit.metadata) || !isObj(audit.metadata.vulnerabilities)) {
    return null;
  }
  const v = audit.metadata.vulnerabilities;
  const n = (x: unknown): number => (typeof x === 'number' ? x : 0);
  return n(v.high) + n(v.critical);
}

/** SEC 케이스의 UNIT별 통과/전체. */
export function secByUnit(results: CaseResult[]): { unit: string; pass: number; total: number }[] {
  const m = new Map<string, { unit: string; pass: number; total: number }>();
  for (const c of results) {
    const t = c.id === null ? null : parseTestId(c.id);
    if (t?.kind !== 'SEC' || t.unit === null) {
      continue;
    }
    const row = m.get(t.unit) ?? { unit: t.unit, pass: 0, total: 0 };
    row.total++;
    if (c.status === 'pass') {
      row.pass++;
    }
    m.set(t.unit, row);
  }
  return [...m.values()].sort((a, b) => (a.unit < b.unit ? -1 : 1));
}

export function renderSec(input: SecInput): string {
  const high = auditHighCritical(input.audit);
  const security = input.gates?.gates.find((g) => g.id === 'check:security');
  const units = secByUnit(input.results);
  const total = units.reduce((s, u) => s + u.total, 0);
  const pass = units.reduce((s, u) => s + u.pass, 0);
  return document([
    `# SEC-${input.int} 보안약점 진단 결과 (자동 생성)`,
    input.header,
    '',
    '## 1. 자동 점검',
    table(
      ['점검', '결과', '비고'],
      [
        [
          'pnpm audit --prod --audit-level high (high + critical)',
          high === null ? 'n/a (audit.json 없음)' : high,
          high === null ? '' : high === 0 ? 'PASS' : 'FAIL',
        ],
        [
          'check:security',
          security === undefined ? 'n/a (gates.json 없음)' : `exit ${security.exit}`,
          security === undefined ? '' : `errors=${security.errors} warnings=${security.warnings}`,
        ],
        [
          'SEC 케이스(전체)',
          `${pass}/${total}`,
          total === 0 ? 'n/a (sec.json 결과 없음)' : pass === total ? 'PASS' : 'FAIL',
        ],
        ...units.map((u) => [
          `SEC-${u.unit} (${u.unit === 'SYS' ? 'system' : (UNIT_LABEL[u.unit] ?? u.unit)})`,
          `${u.pass}/${u.total}`,
          u.pass === u.total ? 'PASS' : 'FAIL',
        ]),
      ],
    ),
    '',
    '## 2. 항목별 점검',
    table(['항목', '적용', '점검 방법(테스트 ID)', '결과', '조치'], []),
    '',
    '## 3. 잔여 위험(RSK-RUN · 수용 위험) 변동',
    '(T1 기입)',
    '',
    '## 4. 판정(T1): High 이상 미해결 0 / Medium 사유',
    '(T1 기입)',
  ]);
}
