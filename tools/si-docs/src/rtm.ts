// rtm: 요구(FR·NFR) × 테스트(제목 참조) × 결과 → rtm.json + RTM-<INT>.md (PGM-SID-001, UR-07, PR-018).
// 순수 함수 — 파일 I/O·시계·git은 cli.ts가 주입한다.
import { document, table } from './markdown.js';
import { type CaseResult, mergeById, suiteOfId } from './results.js';
import { compareInt, type ReqRow } from './rtm-source.js';
import { expandReq, parseTitle, type SourceTitle, type TitleProblem } from './titles.js';
import { type ClassSummary, type VerificationClass, type VMismatch, vMismatches } from './verification-class.js';

export type ReqStatus = 'met' | 'unmet' | 'orphan' | 'untested' | 'future' | 'deferred';
export type TestStatus = 'pass' | 'fail' | 'skip' | 'unknown';

export interface RtmTest {
  id: string;
  status: TestStatus;
  suite: string;
  file: string;
}

export interface RtmRequirement {
  id: string;
  kind: 'FR' | 'NFR';
  priority: string;
  slice: string;
  v: string;
  v_build: true;
  first_int: string | null;
  deferred: boolean;
  status: ReqStatus;
  tests: RtmTest[];
}

export interface RtmSummary {
  requirements: number;
  met: number;
  unmet: number;
  orphan: number;
  untested: number;
  future: number;
  deferred: number;
}

export interface RtmJson {
  version: 1;
  int: string;
  generated_at: number;
  commit: string;
  summary: RtmSummary;
  requirements: RtmRequirement[];
  unknown_refs: { test: string; ref: string; file: string; line: number }[];
  title_errors: { file: string; line: number; title: string; reason: string }[];
  v_mismatch: VMismatch[];
}

export interface RtmInput {
  int: string;
  rows: ReqRow[];
  titles: SourceTitle[];
  titleErrors: TitleProblem[];
  results: CaseResult[];
  manifest: VerificationClass | null;
  generatedAt: number;
  commit: string;
}

export interface RtmBuild {
  json: RtmJson;
  /** 요구 ID → 이름(rtm.json 에는 없고 마크다운에만 쓴다). */
  names: Record<string, string>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Mapped {
  id: string;
  file: string;
  line: number;
  reqs: string[];
}

/** 요구 한 개의 판정(현재 INT = I). */
export function judge(
  req: { first_int: string | null; deferred: boolean },
  tests: RtmTest[],
  currentInt: string,
): ReqStatus {
  if (req.deferred || req.first_int === null) {
    return 'deferred';
  }
  if (compareInt(req.first_int, currentInt) > 0) {
    return 'future';
  }
  if (tests.length === 0) {
    return 'orphan';
  }
  if (tests.some((t) => t.status === 'fail' || t.status === 'skip')) {
    return 'unmet';
  }
  if (tests.every((t) => t.status === 'unknown')) {
    return 'untested';
  }
  return 'met';
}

export function buildRtm(input: RtmInput): RtmBuild {
  const known = new Set(input.rows.map((r) => r.id));
  const resultById = new Map<string, CaseResult>();
  for (const c of mergeById(input.results)) {
    if (c.id !== null) {
      resultById.set(c.id, c);
    }
  }
  // 테스트 → 요구 매핑: 소스 제목 ∪ 결과 제목
  const mapped = new Map<string, Mapped>();
  const add = (m: Mapped): void => {
    const prev = mapped.get(m.id);
    if (prev === undefined) {
      mapped.set(m.id, { ...m, reqs: [...new Set(m.reqs)] });
    } else {
      prev.reqs = [...new Set([...prev.reqs, ...m.reqs])];
    }
  };
  for (const t of [...input.titles].sort((a, b) => cmp(a.file, b.file) || a.line - b.line)) {
    add({ id: t.id, file: t.file, line: t.line, reqs: t.reqs });
  }
  const unknownRefs = new Map<string, { test: string; ref: string; file: string; line: number }>();
  const checkRefs = (test: string, refs: string[], file: string, line: number): void => {
    for (const ref of refs.flatMap(expandReq)) {
      if (!known.has(ref) && !unknownRefs.has(`${test}|${ref}`)) {
        unknownRefs.set(`${test}|${ref}`, { test, ref, file, line });
      }
    }
  };
  for (const t of input.titles) {
    checkRefs(t.id, t.refs, t.file, t.line);
  }
  for (const c of input.results) {
    const p = parseTitle(c.title);
    if (c.id !== null && p.ok) {
      add({ id: c.id, file: c.file, line: 0, reqs: p.value.reqs });
      checkRefs(c.id, p.value.refs, c.file, 0);
    }
  }
  const byReq = new Map<string, string[]>();
  for (const m of mapped.values()) {
    for (const r of m.reqs) {
      byReq.set(r, [...(byReq.get(r) ?? []), m.id]);
    }
  }
  const requirements: RtmRequirement[] = [...input.rows]
    .sort((a, b) => cmp(a.id, b.id))
    .map((r) => {
      const tests: RtmTest[] = [...new Set(byReq.get(r.id) ?? [])].sort(cmp).map((id) => {
        const res = resultById.get(id);
        const src = mapped.get(id);
        return {
          id,
          status: (res?.status ?? 'unknown') as TestStatus,
          suite: res?.suite ?? suiteOfId(id) ?? 'ut',
          file: src?.file ?? res?.file ?? '',
        };
      });
      return {
        id: r.id,
        kind: r.kind,
        priority: r.priority,
        slice: r.slice,
        v: r.v,
        v_build: true as const,
        first_int: r.first_int,
        deferred: r.deferred,
        status: judge(r, tests, input.int),
        tests,
      };
    });
  const summary: RtmSummary = {
    requirements: requirements.length,
    met: 0,
    unmet: 0,
    orphan: 0,
    untested: 0,
    future: 0,
    deferred: 0,
  };
  for (const r of requirements) {
    summary[r.status]++;
  }
  const json: RtmJson = {
    version: 1,
    int: input.int,
    generated_at: input.generatedAt,
    commit: input.commit,
    summary,
    requirements,
    unknown_refs: [...unknownRefs.values()].sort((a, b) => cmp(a.test, b.test) || cmp(a.ref, b.ref)),
    title_errors: [...input.titleErrors]
      .sort((a, b) => cmp(a.file, b.file) || a.line - b.line)
      .map((e) => ({ file: e.file, line: e.line, title: e.title, reason: e.reason })),
    v_mismatch: input.manifest === null ? [] : vMismatches(input.rows, input.manifest),
  };
  return { json, names: Object.fromEntries(input.rows.map((r) => [r.id, r.name])) };
}

const STATUS_LABEL: Record<ReqStatus, string> = {
  met: '충족(met)',
  unmet: '미충족(unmet)',
  orphan: '고아(orphan)',
  untested: '미실행(untested)',
  future: '이후 INT(future)',
  deferred: '이월(deferred)',
};

function testsCell(r: RtmRequirement): string {
  if (r.tests.length === 0) {
    return '—';
  }
  const shown = r.tests
    .slice(0, 6)
    .map((t) => t.id)
    .join('·');
  return r.tests.length > 6 ? `${shown} 외 ${r.tests.length - 6}` : shown;
}

function resultCell(r: RtmRequirement): string {
  if (r.tests.length === 0) {
    return '—';
  }
  const n = (s: TestStatus): number => r.tests.filter((t) => t.status === s).length;
  return (['pass', 'fail', 'skip', 'unknown'] as const)
    .filter((s) => n(s) > 0)
    .map((s) => `${s} ${n(s)}`)
    .join(' · ');
}

/** RTM-<INT>.md. `header` = `실행: … · 커밋: … · 명령: … · Node …`(cli가 주입). */
export function renderRtm(build: RtmBuild, header: string, classes: ClassSummary | null): string {
  const { json, names } = build;
  const s = json.summary;
  const lines: string[] = [
    `# RTM-${json.int} 요구사항추적 결과 (자동 생성)`,
    header,
    '',
    '## 요약',
    table(
      ['요구 수', '충족', '미충족', '고아', '미실행', '이후 INT', '이월'],
      [[s.requirements, s.met, s.unmet, s.orphan, s.untested, s.future, s.deferred]],
    ),
    '',
    table(
      ['상태', '개수', '뜻'],
      [
        ['met', s.met, '현재 INT까지 배정, 매핑 테스트가 모두 통과'],
        ['unmet', s.unmet, '매핑 테스트 중 실패·건너뜀 ≥ 1'],
        ['orphan', s.orphan, '현재 INT까지 배정됐으나 매핑 테스트 0'],
        ['untested', s.untested, '매핑 테스트가 소스에는 있으나 결과에 없음'],
        ['future', s.future, '첫 판정 INT 가 현재 INT 이후'],
        ['deferred', s.deferred, 'v1 이월·INT 미배정'],
      ],
    ),
    '',
    '## 요구 × 테스트',
    table(
      ['ID', '이름', '우선·슬', 'V', '첫 판정 INT', '테스트(실측)', '결과', '상태'],
      json.requirements.map((r) => [
        r.id,
        names[r.id] ?? '',
        `${r.priority}·${r.slice}`,
        r.v,
        r.first_int ?? '—',
        testsCell(r),
        resultCell(r),
        STATUS_LABEL[r.status],
      ]),
    ),
    '',
    '## 존재하지 않는 요구 참조 (unknown_refs)',
    json.unknown_refs.length === 0
      ? '없음'
      : table(
          ['테스트', '참조', '파일', '줄'],
          json.unknown_refs.map((u) => [u.test, u.ref, u.file, u.line]),
        ),
    '',
    '## 제목 오류 (title_errors)',
    json.title_errors.length === 0
      ? '없음'
      : table(
          ['파일', '줄', '제목', '사유'],
          json.title_errors.map((e) => [e.file, e.line, e.title, e.reason]),
        ),
    '',
    '## 검증 등급 불일치 (v_mismatch)',
    json.v_mismatch.length === 0
      ? '없음'
      : table(
          ['ID', 'RTM V 열', 'verification-class.json'],
          json.v_mismatch.map((m) => [m.id, m.rtm, m.manifest]),
        ),
    '',
    '## 검증 등급 집계',
  ];
  if (classes === null) {
    lines.push('n/a (verification-class 원천 없음)');
  } else {
    lines.push(
      table(
        ['등급 표기', '요구 수'],
        Object.entries(classes.byLabel).map(([k, v]) => [k, v]),
      ),
      '',
      table(
        ['V-build 밖 검증', '요구 수'],
        [
          ['예외 요구(합계)', classes.exceptions],
          ['V-ci', classes.beyond['V-ci'] ?? 0],
          ['V-live', classes.beyond['V-live'] ?? 0],
          ['V-field', classes.beyond['V-field'] ?? 0],
        ],
      ),
    );
  }
  return document(lines);
}
