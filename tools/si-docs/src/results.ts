// results: 테스트 결과 어댑터 3종(vitest JSON · Playwright JSON · node:test TAP) → CaseResult. 순수 함수.
import { parseTestId, TEST_ID_RE } from './ids.js';

export type CaseStatus = 'pass' | 'fail' | 'skip';
export type Suite = 'ut' | 'ct' | 'it' | 'sec' | 'cha' | 'e2e' | 'gate';

export interface CaseResult {
  id: string | null;
  title: string;
  status: CaseStatus;
  durationMs: number;
  suite: Suite;
  file: string;
  /** 실패 메시지 첫 줄(실패 상세 표용). */
  message?: string;
}

const LEADING_ID_RE = /^((?:UT|CT|SEC)-[A-Z]+-\d{3}|IT-\d{3}|E2E-\d{3}|CHA-\d{3}|PRF-\d{3})(?:\s|$)/;

/** 제목 앞의 테스트 ID(유효하지 않으면 null). */
export function idOfTitle(title: string): string | null {
  const m = LEADING_ID_RE.exec(title.trim());
  const id = m?.[1];
  return id !== undefined && parseTestId(id) !== null && TEST_ID_RE.test(id) ? id : null;
}

/** 상태 정규화: passed·ok → pass, failed·timedOut·not ok → fail, skipped·pending·todo → skip. */
export function normalizeStatus(raw: string): CaseStatus {
  switch (raw) {
    case 'passed':
    case 'ok':
    case 'pass':
    case 'expected':
      return 'pass';
    case 'skipped':
    case 'pending':
    case 'todo':
    case 'skip':
    case 'disabled':
      return 'skip';
    default:
      return 'fail';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const firstLine = (s: string): string => s.trim().split(/\r?\n/)[0] ?? '';

/** vitest `--reporter=json`: testResults[].assertionResults[]. */
export function parseVitestJson(data: unknown, suite: Suite): CaseResult[] {
  const out: CaseResult[] = [];
  if (!isObj(data)) {
    return out;
  }
  for (const tr of arr(data.testResults)) {
    if (!isObj(tr)) {
      continue;
    }
    const file = str(tr.name);
    for (const a of arr(tr.assertionResults)) {
      if (!isObj(a)) {
        continue;
      }
      const title = str(a.title) || str(a.fullName);
      const status = normalizeStatus(str(a.status));
      const failure = arr(a.failureMessages)
        .map(str)
        .find((m) => m !== '');
      out.push({
        id: idOfTitle(title),
        title,
        status,
        durationMs: num(a.duration),
        suite,
        file,
        ...(status === 'fail' && failure !== undefined ? { message: firstLine(failure) } : {}),
      });
    }
  }
  return out;
}

/** Playwright `--reporter=json`: suites[] 재귀, specs[].tests[].results[] 마지막 결과 기준. */
export function parsePlaywrightJson(data: unknown, suite: Suite): CaseResult[] {
  const out: CaseResult[] = [];
  const visit = (s: unknown, file: string): void => {
    if (!isObj(s)) {
      return;
    }
    const f = str(s.file) || file;
    for (const spec of arr(s.specs)) {
      if (!isObj(spec)) {
        continue;
      }
      const title = str(spec.title);
      const specFile = str(spec.file) || f;
      const results: Record<string, unknown>[] = [];
      for (const t of arr(spec.tests)) {
        if (isObj(t)) {
          const rs = arr(t.results).filter(isObj);
          const last = rs[rs.length - 1];
          if (last !== undefined) {
            results.push(last);
          } else if (str(t.status) === 'skipped') {
            results.push({ status: 'skipped', duration: 0 });
          }
        }
      }
      const statuses = results.map((r) => normalizeStatus(str(r.status)));
      const status: CaseStatus = statuses.includes('fail')
        ? 'fail'
        : statuses.length > 0 && statuses.every((x) => x === 'skip')
          ? 'skip'
          : 'pass';
      const failed = results.find((r) => normalizeStatus(str(r.status)) === 'fail');
      const err = failed !== undefined && isObj(failed.error) ? str(failed.error.message) : '';
      out.push({
        id: idOfTitle(title),
        title,
        status,
        durationMs: results.reduce((sum, r) => sum + num(r.duration), 0),
        suite,
        file: specFile,
        ...(status === 'fail' && err !== '' ? { message: firstLine(err) } : {}),
      });
    }
    for (const child of arr(s.suites)) {
      visit(child, f);
    }
  };
  if (isObj(data)) {
    for (const s of arr(data.suites)) {
      visit(s, '');
    }
  }
  return out;
}

const TAP_RESULT_RE = /^(\s*)(not ok|ok)\s+\d+\s*-?\s*(.*?)\s*$/;
const TAP_DIRECTIVE_RE = /\s+#\s*(SKIP|TODO)\b.*$/i;

/** node:test TAP. `# SKIP`·`# TODO` 지시문은 skip, 들여쓴 하위 결과도 모두 읽는다. */
export function parseTap(text: string, suite: Suite, file = ''): CaseResult[] {
  const out: CaseResult[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = TAP_RESULT_RE.exec(lines[i] ?? '');
    if (!m) {
      continue;
    }
    let title = m[3] ?? '';
    const directive = TAP_DIRECTIVE_RE.exec(title);
    title = title.replace(TAP_DIRECTIVE_RE, '').trim();
    const status: CaseStatus = directive !== null ? 'skip' : m[2] === 'ok' ? 'pass' : 'fail';
    let durationMs = 0;
    let message: string | undefined;
    for (let j = i + 1; j < lines.length && !TAP_RESULT_RE.test(lines[j] ?? ''); j++) {
      const d = /^\s*duration_ms:\s*([0-9.]+)/.exec(lines[j] ?? '');
      if (d?.[1] !== undefined) {
        durationMs = Number(d[1]);
      }
      const e = /^\s*error:\s*['"|>-]*\s*(.*)$/.exec(lines[j] ?? '');
      if (e?.[1] !== undefined && e[1] !== '' && message === undefined) {
        message = e[1].replace(/['"]\s*$/, '');
      }
    }
    out.push({
      id: idOfTitle(title),
      title,
      status,
      durationMs,
      suite,
      file,
      ...(status === 'fail' && message !== undefined ? { message: firstLine(message) } : {}),
    });
  }
  return out;
}

/** 입력 하나(`key` = 스위트 키, `name` = 파일 이름)를 형식 자동 판별해 파싱한다. */
export interface ResultInput {
  /** ut|ct|it|sec|cha|e2e 중 하나(입력 위치에서 정해진 스위트), 알 수 없으면 null. */
  key: Suite | null;
  name: string;
  text: string;
}

const SUITE_BY_PREFIX: Record<string, Suite> = {
  UT: 'ut',
  CT: 'ct',
  IT: 'it',
  SEC: 'sec',
  CHA: 'cha',
  E2E: 'e2e',
  PRF: 'it',
};

/** ID 접두로 스위트를 정한다(입력 키가 없을 때). */
export function suiteOfId(id: string | null): Suite | null {
  if (id === null) {
    return null;
  }
  const prefix = id.split('-')[0] ?? '';
  return SUITE_BY_PREFIX[prefix] ?? null;
}

export function parseResultInput(input: ResultInput): CaseResult[] {
  const suite: Suite = input.key ?? 'ut';
  if (input.name.endsWith('.tap')) {
    return parseTap(input.text, input.key ?? 'gate', input.name).map((c) => ({ ...c, suite: input.key ?? 'gate' }));
  }
  let data: unknown;
  try {
    data = JSON.parse(input.text);
  } catch {
    return [];
  }
  if (isObj(data) && Array.isArray(data.testResults)) {
    return parseVitestJson(data, suite);
  }
  if (isObj(data) && Array.isArray(data.suites)) {
    return parsePlaywrightJson(data, input.key ?? 'e2e');
  }
  return [];
}

const rank: Record<CaseStatus, number> = { pass: 0, skip: 1, fail: 2 };

/** 같은 ID가 여러 번이면 하나로 합친다: 하나라도 fail이면 fail(그다음 skip). id 없는 케이스는 그대로 둔다. */
export function mergeById(cases: CaseResult[]): CaseResult[] {
  const byId = new Map<string, CaseResult>();
  const rest: CaseResult[] = [];
  for (const c of cases) {
    if (c.id === null) {
      rest.push(c);
      continue;
    }
    const prev = byId.get(c.id);
    if (prev === undefined) {
      byId.set(c.id, c);
    } else if (rank[c.status] > rank[prev.status]) {
      byId.set(c.id, { ...c, durationMs: c.durationMs + prev.durationMs });
    } else {
      byId.set(c.id, { ...prev, durationMs: prev.durationMs + c.durationMs });
    }
  }
  return [...[...byId.values()].sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : 1)), ...rest];
}

/** 모든 입력을 읽어 하나의 목록으로(스위트는 입력 키 → 없으면 ID 접두). */
export function collectResults(inputs: ResultInput[]): CaseResult[] {
  const all: CaseResult[] = [];
  for (const input of inputs) {
    for (const c of parseResultInput(input)) {
      all.push({ ...c, suite: input.name.endsWith('.tap') ? 'gate' : (input.key ?? suiteOfId(c.id) ?? c.suite) });
    }
  }
  return mergeById(all);
}
