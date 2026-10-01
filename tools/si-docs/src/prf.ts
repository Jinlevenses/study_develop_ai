// prf: PRF-<INT>.md 성능 점검 결과(TST §20.3). prf.json 형식은 tests/perf/run-all.ts(후속 WP)가 따른다. 순수 함수.
import { document, table } from './markdown.js';

export interface PrfRun {
  id: string;
  target: string;
  condition: string;
  threshold_ms: number;
  p95_ms: number[];
}

export interface PrfData {
  runs: PrfRun[];
  env?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ "runs": [ { id, target, condition, threshold_ms, p95_ms: number[] } ] }`. 모양이 다르면 null. */
export function parsePrf(data: unknown): PrfData | null {
  if (!isObj(data) || !Array.isArray(data.runs)) {
    return null;
  }
  const runs: PrfRun[] = [];
  for (const r of data.runs as unknown[]) {
    if (
      !isObj(r) ||
      typeof r.id !== 'string' ||
      typeof r.threshold_ms !== 'number' ||
      !Array.isArray(r.p95_ms) ||
      !r.p95_ms.every((n: unknown) => typeof n === 'number')
    ) {
      return null;
    }
    runs.push({
      id: r.id,
      target: typeof r.target === 'string' ? r.target : '',
      condition: typeof r.condition === 'string' ? r.condition : '',
      threshold_ms: r.threshold_ms,
      p95_ms: r.p95_ms as number[],
    });
  }
  return { runs, ...(typeof data.env === 'string' ? { env: data.env } : {}) };
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export interface PrfVerdict {
  median: number | null;
  /** 중앙값 ≤ 임계 ∧ 어느 회차도 임계 × 1.5 초과 없음(D-TST-18). */
  pass: boolean;
  /** 임계 × 1.5 초과 회차(1-based). */
  overRuns: number[];
}

export function verdict(run: PrfRun): PrfVerdict {
  const med = median(run.p95_ms);
  const overRuns = run.p95_ms.map((v, i) => (v > run.threshold_ms * 1.5 ? i + 1 : 0)).filter((i) => i > 0);
  return { median: med, pass: med !== null && med <= run.threshold_ms && overRuns.length === 0, overRuns };
}

const fmtMs = (ms: number): string =>
  ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000}s` : `${Number.isInteger(ms) ? ms : ms.toFixed(1)}ms`;

export function renderPrf(int: string, header: string, data: PrfData): string {
  const width = Math.max(3, ...data.runs.map((r) => r.p95_ms.length));
  const heads = [
    'PRF',
    '대상',
    '조건',
    '임계',
    ...Array.from({ length: width }, (_, i) => `run${i + 1} p95`),
    '중앙값',
    '판정',
  ];
  const rows = data.runs.map((r) => {
    const v = verdict(r);
    return [
      r.id,
      r.target,
      r.condition,
      `≤ ${fmtMs(r.threshold_ms)}`,
      ...Array.from({ length: width }, (_, i) => {
        const x = r.p95_ms[i];
        return x === undefined ? '—' : fmtMs(x);
      }),
      v.median === null ? 'n/a' : fmtMs(v.median),
      v.median === null ? 'n/a' : v.pass ? 'PASS' : 'FAIL',
    ];
  });
  const over = data.runs.flatMap((r) => {
    const v = verdict(r);
    const reasons: string[][] = [];
    if (v.median !== null && v.median > r.threshold_ms) {
      reasons.push([r.id, '중앙값 임계 초과', `${fmtMs(v.median)} > ${fmtMs(r.threshold_ms)}`]);
    }
    for (const run of v.overRuns) {
      reasons.push([
        r.id,
        `run${run} 임계 × 1.5 초과`,
        `${fmtMs(r.p95_ms[run - 1] ?? 0)} > ${fmtMs(r.threshold_ms * 1.5)}`,
      ]);
    }
    return reasons;
  });
  return document([
    `# PRF-${int} 성능 점검 결과 (자동 생성)`,
    header,
    `환경: ${data.env ?? 'n/a'}`,
    '',
    data.runs.length === 0 ? 'PRF 실행 기록 없음.' : table(heads, rows),
    '',
    '## 추세(직전 전체 세트 대비)',
    'n/a (직전 세트 입력 없음)',
    '',
    '## 임계 위반 · 1.5배 초과 회차 상세',
    over.length === 0 ? '없음' : table(['PRF', '사유', '값'], over),
  ]);
}
