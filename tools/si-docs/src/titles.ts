// titles: 테스트 제목 파서(STD-TST-01, TST §11.1)와 소스 정적 스캔. 순수 함수 — 파일 읽기는 cli가 하고 문자열을 넘긴다.
import { parseTestId, type TestId } from './ids.js';

export type TitleErrorReason = 'no-id' | 'no-req' | 'dynamic-title';

export interface ParsedTitle {
  id: string;
  test: TestId;
  desc: string;
  /** 대괄호 토큰 전부. */
  refs: string[];
  /** 유효 참조(FR·NFR·IR·DR·PR·QAS·IF). */
  validRefs: string[];
  /** 요구 ID(FR·NFR, 범위 `FR-X-001~003` 은 개별 ID로 확장). */
  reqs: string[];
}

export type TitleParse = { ok: true; value: ParsedTitle } | { ok: false; reason: TitleErrorReason; message: string };

const TITLE_RE =
  /^(?<id>(?:UT|CT|SEC)-[A-Z]+-\d{3}|IT-\d{3}|E2E-\d{3}|CHA-\d{3}|PRF-\d{3})\s+(?<desc>.*?)\s*(?<refs>(?:\[[^\]]+\])+)?\s*$/;
const REQ_RE = /^(FR|NFR)-[A-Z]+-\d{3}$/;
const REQ_RANGE_RE = /^((?:FR|NFR)-[A-Z]+-)(\d{3})~(\d{3})$/;
const VALID_REF_RE = /^(FR|NFR|IR|DR|PR|QAS|IF)-[A-Z0-9-]+(~\d{3})?$/;

/** 참조 토큰 하나 → 요구 ID 목록(요구가 아니면 빈 배열). */
export function expandReq(token: string): string[] {
  if (REQ_RE.test(token)) {
    return [token];
  }
  const m = REQ_RANGE_RE.exec(token);
  if (!m) {
    return [];
  }
  const from = Number(m[2]);
  const to = Number(m[3]);
  const out: string[] = [];
  for (let n = from; n <= to && n - from < 200; n++) {
    out.push(`${m[1]}${String(n).padStart(3, '0')}`);
  }
  return out;
}

/** 제목 문자열 하나를 파싱한다. 오류 사유 = no-id · no-req (dynamic-title 은 소스 스캔이 낸다). */
export function parseTitle(title: string): TitleParse {
  const m = TITLE_RE.exec(title.trim());
  const id = m?.groups?.id;
  if (m === null || id === undefined) {
    return {
      ok: false,
      reason: 'no-id',
      message: `title must start with a test ID (UT-<UNIT>-nnn, IT-nnn, E2E-nnn …): "${title}"`,
    };
  }
  const test = parseTestId(id);
  if (test === null) {
    return { ok: false, reason: 'no-id', message: `unknown test ID or UNIT: ${id}` };
  }
  const refs = [...(m.groups?.refs ?? '').matchAll(/\[([^\]]+)\]/g)].map((r) => r[1] ?? '');
  const validRefs = refs.filter((r) => VALID_REF_RE.test(r));
  if (validRefs.length === 0) {
    return {
      ok: false,
      reason: 'no-req',
      message: `${id} has no valid requirement reference ([FR-…]·[NFR-…]·[IF-…] …)`,
    };
  }
  const reqs = [...new Set(refs.flatMap(expandReq))];
  return { ok: true, value: { id, test, desc: m.groups?.desc ?? '', refs, validRefs, reqs } };
}

export interface SourceTitle extends ParsedTitle {
  title: string;
  file: string;
  line: number;
}

export interface TitleProblem {
  file: string;
  line: number;
  title: string;
  reason: TitleErrorReason;
}

export interface ScanResult {
  titles: SourceTitle[];
  errors: TitleProblem[];
}

/** 스캔 대상 테스트 소스 경로인가(Brief §4.3.3). */
export function isTestSourcePath(rel: string): boolean {
  if (rel.includes('/fixtures/')) {
    return false;
  }
  return (
    /^(?:apps|services|packages|tools)\/[^/]+\/test\/.+\.spec\.(?:ts|tsx)$/.test(rel) ||
    /^tools\/gates\/test\/[^/]+\.test\.mjs$/.test(rel) ||
    /^tests\/.+\.spec\.ts$/.test(rel) ||
    /^tests\/perf\/[^/]+\.ts$/.test(rel)
  );
}

const CALL_RE = /(?<![.\w$])(it|test)(?:\.(?:only|skip|todo|concurrent))?\(\s*(['"`])(.+?)\2/g;

/** 한 파일의 `it(…)`·`test(…)` 제목을 모은다(주석 줄 제외). */
export function scanSource(file: string, text: string): ScanResult {
  const titles: SourceTitle[] = [];
  const errors: TitleProblem[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }
    for (const m of raw.matchAll(CALL_RE)) {
      const quote = m[2];
      const title = m[3] ?? '';
      const line = idx + 1;
      if (quote === '`' && title.includes('${')) {
        errors.push({ file, line, title, reason: 'dynamic-title' });
        continue;
      }
      const parsed = parseTitle(title);
      if (!parsed.ok) {
        errors.push({ file, line, title, reason: parsed.reason });
        continue;
      }
      titles.push({ ...parsed.value, title, file, line });
    }
  });
  return { titles, errors };
}

/** 여러 파일 스캔(경로 정렬, 테스트 소스 경로가 아닌 파일은 건너뛴다). */
export function scanSources(files: { path: string; text: string }[]): ScanResult {
  const out: ScanResult = { titles: [], errors: [] };
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!isTestSourcePath(f.path)) {
      continue;
    }
    const r = scanSource(f.path, f.text);
    out.titles.push(...r.titles);
    out.errors.push(...r.errors);
  }
  return out;
}
