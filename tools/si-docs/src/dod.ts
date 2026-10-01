// dod: DOD-<INT>.md Product DoD 판정서(TST §17 14행 · §20.5). 순수 함수.
import { expandRange, parseRangeItem, parseTestId } from './ids.js';
import type { GatesJson } from './itr.js';
import { document, table } from './markdown.js';
import type { CaseResult } from './results.js';

export interface DodRow {
  d: string;
  condition: string;
  /** 표에 보이는 검증 테스트 문구(TST §17 원문). */
  label: string;
  /** 판정에 쓰는 테스트 ID·범위(`E2E-301~321` 은 확장). */
  tests: string[];
  /** gates.json 에서 exit 로 판정하는 게이트 ID. */
  gates: string[];
  /** 자동 판정 불가 항목([I] 검사·명령형) — T1 확인. */
  inspection: string[];
  evidence: string;
}

/** TST §17 D-1~D-14. SEC-CT-001~299 는 TST §11.2 의 실제 번호 대역으로 푼다. */
export const DOD_ROWS: DodRow[] = [
  {
    d: 'D-1',
    condition: 'UR-14 6계열 + 매니페스트 모드 OFFLINE E2E · 외부 호출 0',
    label: 'E2E-100·101, E2E-301~321(included), IT-026, check:manifest, CT-SYS-008',
    tests: ['E2E-100~101', 'E2E-301~321', 'IT-026', 'CT-SYS-008'],
    gates: ['check:manifest'],
    inspection: ['ci-matrix windows·macos 워크플로 존재 [I]'],
    evidence: 'ITR E2E 표, egress.json(격리 수준 표기)',
  },
  {
    d: 'D-2',
    condition: '설치 → 첫 세션 ≤ 3분',
    label: 'E2E-102',
    tests: ['E2E-102'],
    gates: [],
    inspection: [],
    evidence: 'ITR 소요 시간',
  },
  {
    d: 'D-3',
    condition: '첫 문항 p95 ≤ 2s',
    label: 'PRF-001(+ PRF-011 15년 규모)',
    tests: ['PRF-001', 'PRF-011'],
    gates: [],
    inspection: [],
    evidence: 'PRF',
  },
  {
    d: 'D-4',
    condition: '원장만 리플레이 = 라이브, 병합 순서 무관',
    label: 'UT-LR-500~503·600, IT-009·010·013',
    tests: ['UT-LR-500~503', 'UT-LR-600', 'IT-009', 'IT-010', 'IT-013'],
    gates: [],
    inspection: [],
    evidence: 'UTR·ITR',
  },
  {
    d: 'D-5',
    condition: 'T1 = 실행 100%',
    label: 'UT-CT-200, packc V4 리포트(UT-PACKC), IT-651',
    tests: ['UT-CT-200', 'IT-651'],
    gates: [],
    inspection: ['packc V4 리포트(UT-PACKC) 실패 0 — packs.json 확인'],
    evidence: 'UTR, packs.json',
  },
  {
    d: 'D-6',
    condition: '게이트 없는 AI 문항 · deferred 출제 0',
    label: 'IT-036, ai:eval:gates, UT-CT-202·203, CT-CT-201',
    tests: ['IT-036', 'UT-CT-202', 'UT-CT-203', 'CT-CT-201'],
    gates: [],
    inspection: ['pnpm ai:eval:gates exit 0 (ai-eval.json)'],
    evidence: 'ITR, ai-eval.json',
  },
  {
    d: 'D-7',
    condition: 'SCN-01~14(v1 범위)',
    label: 'E2E-001~073(§12.2 표 전 행)',
    tests: ['E2E-001~073'],
    gates: [],
    inspection: [],
    evidence: 'ITR SCN 표',
  },
  {
    d: 'D-8',
    condition: 'export ↔ import · epoch 복원',
    label: 'IT-012, IT-005~008, IT-603, E2E-013',
    tests: ['IT-012', 'IT-005~008', 'IT-603', 'E2E-013'],
    gates: [],
    inspection: [],
    evidence: 'ITR',
  },
  {
    d: 'D-9',
    condition: '서비스 1개 종료 시 학습 계속',
    label: 'CHA-001~005, IT-019·020',
    tests: ['CHA-001~005', 'IT-019', 'IT-020'],
    gates: [],
    inspection: [],
    evidence: 'CHA 표(ITR)',
  },
  {
    d: 'D-10',
    condition: 'NG-G · 대비 · 타이포 lint',
    label: 'check:ng-g·check:typo-ko(G2), UT-TOK-001, E2E-501',
    tests: ['UT-TOK-001', 'E2E-501'],
    gates: ['check:ng-g', 'check:typo-ko'],
    inspection: [],
    evidence: 'gates.json, ITR',
  },
  {
    d: 'D-11',
    condition: '콘텐츠 하한 + 3단 KPI + cap 표',
    label: 'pnpm packs:build --release(DCP-01 §7.6), IT-651',
    tests: ['IT-651'],
    gates: [],
    inspection: ['pnpm packs:build --release exit 0, floor.*.ok = true [I]'],
    evidence: 'docs/40-impl/reports/PACK-INT-7.md',
  },
  {
    d: 'D-12',
    condition: '러너 차단 목록 + RSK-RUN',
    label: 'SEC-CT-001~299(§14.2), RSK-RUN 문서 [I]',
    tests: ['SEC-CT-001~037', 'SEC-CT-101~114', 'SEC-CT-151~166', 'SEC-CT-171~177', 'SEC-CT-201~206', 'SEC-CT-211~213'],
    gates: [],
    inspection: ['docs/40-impl/reports/RSK-RUN.md 존재 [I]'],
    evidence: 'SEC',
  },
  {
    d: 'D-13',
    condition: '디자인 루브릭 ≥ 4.0 + 사용성 5종',
    label: 'E2E-201~205 [T], E2E-502 스크린샷 → T1 루브릭 [I]',
    tests: ['E2E-201~205', 'E2E-502'],
    gates: [],
    inspection: ['T1 루브릭 평균 ≥ 4.0, 차원 < 3 없음 [I]'],
    evidence: 'INT-7 디자인 리뷰 표',
  },
  {
    d: 'D-14',
    condition: 'V-live 작업 자동 생성',
    label: 'UT-AI-004, IT-026, E2E-013',
    tests: ['UT-AI-004', 'IT-026', 'E2E-013'],
    gates: [],
    inspection: [],
    evidence: 'ITR',
  },
];

export type DodVerdict = 'PASS' | 'FAIL' | '미실행';

export interface DodEvaluation {
  row: DodRow;
  verdict: DodVerdict;
  /** 확인된 항목 / 전체 항목(표의 증거 열에 표시). */
  detail: string;
}

/** 범위 항목 → 개별 ID(`E2E-301~321` 확장, 형식이 아니면 그대로 한 항목). */
export function expandItem(item: string): string[] {
  const r = parseRangeItem(item);
  if (r !== null && r.from !== r.to) {
    return expandRange(r);
  }
  return [item];
}

export function evaluateDod(row: DodRow, results: CaseResult[], gates: GatesJson | null): DodEvaluation {
  const byId = new Map(results.filter((c) => c.id !== null).map((c) => [c.id ?? '', c]));
  const ids = row.tests.flatMap(expandItem).filter((id) => parseTestId(id) !== null);
  let present = 0;
  let passed = 0;
  let failed = 0;
  for (const id of ids) {
    const c = byId.get(id);
    if (c === undefined) {
      continue;
    }
    present++;
    if (c.status === 'pass') {
      passed++;
    } else {
      failed++;
    }
  }
  let gatePresent = 0;
  let gatePassed = 0;
  for (const g of row.gates) {
    const r = gates?.gates.find((x) => x.id === g);
    if (r !== undefined && r.skipped === undefined) {
      gatePresent++;
      if (r.exit === 0) {
        gatePassed++;
      } else {
        failed++;
      }
    }
  }
  const total = ids.length + row.gates.length;
  const found = present + gatePresent;
  const detail = `${passed + gatePassed}/${total} 통과${row.inspection.length > 0 ? ` · 검사 ${row.inspection.length}건 T1 확인` : ''}`;
  if (found === 0) {
    return { row, verdict: '미실행', detail };
  }
  if (failed > 0 || found < total) {
    return { row, verdict: 'FAIL', detail };
  }
  return { row, verdict: 'PASS', detail };
}

export interface DodInput {
  int: string;
  header: string;
  results: CaseResult[];
  gates: GatesJson | null;
  /** runner_verified_platforms.json 의 내용(문자열 표기) 또는 null. */
  platforms: string | null;
}

export function renderDod(input: DodInput): string {
  const evals = DOD_ROWS.map((r) => evaluateDod(r, input.results, input.gates));
  return document([
    `# DOD-${input.int} Product DoD 판정서 (자동 생성)`,
    input.header,
    '',
    table(
      ['D', '조건', '검증 테스트', '결과', '증거'],
      evals.map((e) => [e.row.d, e.row.condition, e.row.label, e.verdict, `${e.row.evidence} (${e.detail})`]),
    ),
    '',
    '## 자동 판정 밖 항목(T1 확인)',
    table(
      ['D', '항목'],
      DOD_ROWS.flatMap((r) => r.inspection.map((i) => [r.d, i])),
    ),
    '',
    '## V-ci · V-live 상태(비게이트, 정직 표기)',
    table(
      ['항목', '상태', '근거'],
      [
        ['runner_verified_platforms', input.platforms ?? 'n/a (runner_verified_platforms.json 없음)', 'ci-matrix run'],
        ['Windows · macOS', 'n/a (os-support.md 입력 없음)', 'os-support.md'],
        ['SP-1 · SP-8', 'V-live pending(사전 확정 대응 적용)', '—'],
      ],
    ),
    '',
    '## 판정: (T1 기입)',
  ]);
}
