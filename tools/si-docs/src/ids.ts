// ids: 테스트 ID 정규식·위치 규칙·Brief 범위 파서·ID 검사(UT-SID-002, STD-NAM-96, D-P00-06). 순수 함수 — 파일 I/O 없음.

export type TestKind = 'UT' | 'CT' | 'IT' | 'E2E' | 'SEC' | 'CHA' | 'PRF';

/** TST §11.1 UNIT 집합. UT = 이 집합, CT·SEC = 이 집합 + SYS. */
export const UNITS = [
  'GW',
  'CT',
  'LR',
  'AI',
  'OP',
  'SUP',
  'WEB',
  'CLI',
  'CON',
  'SK',
  'TOK',
  'UI',
  'TK',
  'GATE',
  'PACKC',
  'GRAPH',
  'FCLI',
  'SID',
] as const;

/** UNIT ↔ 단위 디렉터리(STD-NAM-96). SUP·OP 모두 services/ops. */
export const UNIT_DIR: Record<string, string> = {
  GW: 'services/gateway',
  CT: 'services/content',
  LR: 'services/learning',
  AI: 'services/ai-gateway',
  OP: 'services/ops',
  SUP: 'services/ops',
  WEB: 'apps/web',
  CLI: 'apps/cli',
  CON: 'packages/contracts',
  SK: 'packages/shared-kernel',
  TOK: 'packages/design-tokens',
  UI: 'packages/ui',
  TK: 'packages/testkit',
  GATE: 'tools/gates',
  PACKC: 'tools/packc',
  GRAPH: 'tools/graph',
  FCLI: 'tools/fake-cli',
  SID: 'tools/si-docs',
};

/** 결과서·표에서 쓰는 서비스 이름(UNIT → 짧은 이름). */
export const UNIT_LABEL: Record<string, string> = {
  GW: 'gateway',
  CT: 'content',
  LR: 'learning',
  AI: 'ai-gateway',
  OP: 'ops',
  SUP: 'supervisor',
  WEB: 'web',
  CLI: 'cli',
  CON: 'contracts',
  SK: 'shared-kernel',
  TOK: 'design-tokens',
  UI: 'ui',
  TK: 'testkit',
  GATE: 'gates',
  PACKC: 'packc',
  GRAPH: 'graph',
  FCLI: 'fake-cli',
  SID: 'si-docs',
};

const UNIT_SET = new Set<string>(UNITS);

/** 테스트 ID 하나(접두 형식 검증은 parseTestId가 한다). */
export const TEST_ID_RE = /^(?:(UT|CT|SEC)-([A-Z]+)-(\d{3})|(IT|E2E|CHA|PRF)-(\d{3}))$/;

export interface TestId {
  id: string;
  kind: TestKind;
  /** UT·CT·SEC의 UNIT, 그 밖은 null. */
  unit: string | null;
  num: number;
  /** 범위 비교용 접두: `UT-GATE`·`IT`·`E2E` … */
  prefix: string;
}

/** 유효한 테스트 ID면 분해, 아니면 null(알 수 없는 UNIT·2자리 IT-0n 포함). */
export function parseTestId(id: string): TestId | null {
  const m = TEST_ID_RE.exec(id);
  if (!m) {
    return null;
  }
  if (m[1] !== undefined) {
    const kind = m[1] as TestKind;
    const unit = m[2] ?? '';
    const ok = kind === 'UT' ? UNIT_SET.has(unit) : UNIT_SET.has(unit) || unit === 'SYS';
    return ok ? { id, kind, unit, num: Number(m[3]), prefix: `${kind}-${unit}` } : null;
  }
  const kind = m[4] as TestKind;
  return { id, kind, unit: null, num: Number(m[5]), prefix: kind };
}

export const INT_RE = /^(INT-(1a|1b|[2-7])|PG-3)$/;

/** ---- glob(si-docs 안의 작은 구현: `**`·`*`·`?`·`{a,b}`) ---- */
export function expandBraces(p: string): string[] {
  const open = p.indexOf('{');
  if (open < 0) {
    return [p];
  }
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let i = open; i < p.length; i++) {
    const c = p[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (c === ',' && depth === 1) {
      commas.push(i);
    }
  }
  if (close < 0) {
    return [p];
  }
  const head = p.slice(0, open);
  const tail = p.slice(close + 1);
  const bounds = [open, ...commas, close];
  const out: string[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const alt = p.slice((bounds[k] ?? 0) + 1, bounds[k + 1]);
    out.push(...expandBraces(head + alt + tail));
  }
  return out;
}

const RE_SPECIAL = /[.+^$()|[\]\\{}]/;
const reCache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const hit = reCache.get(pattern);
  if (hit) {
    return hit;
  }
  const alts = expandBraces(pattern).map((p) => {
    let out = '';
    let i = 0;
    while (i < p.length) {
      const c = p[i] ?? '';
      if (c === '*') {
        if (p[i + 1] === '*') {
          const atStart = i === 0 || p[i - 1] === '/';
          if (atStart && p[i + 2] === '/') {
            out += '(?:.*/)?';
            i += 3;
            continue;
          }
          out += '.*';
          i += 2;
          continue;
        }
        out += '[^/]*';
        i++;
        continue;
      }
      if (c === '?') {
        out += '[^/]';
        i++;
        continue;
      }
      out += RE_SPECIAL.test(c) ? `\\${c}` : c;
      i++;
    }
    return out;
  });
  const re = new RegExp(`^(?:${alts.join('|')})$`);
  reCache.set(pattern, re);
  return re;
}

export const matchGlob = (rel: string, pattern: string): boolean => globToRegExp(pattern).test(rel);
export const matchAny = (rel: string, patterns: string[]): boolean => patterns.some((p) => matchGlob(rel, p));

/** ---- Brief 범위 ---- */
export interface IdRange {
  prefix: string;
  from: number;
  to: number;
}

export interface BriefInfo {
  taskId: string;
  file: string;
  ranges: IdRange[];
  allowedPaths: string[];
  /** 범위를 `test_ids:` 에서 읽었는가(false = 산문 대체). */
  fromYaml: boolean;
}

const pad3 = (n: number): string => String(n).padStart(3, '0');

export function formatRange(r: IdRange): string {
  return r.from === r.to ? `${r.prefix}-${pad3(r.from)}` : `${r.prefix}-${pad3(r.from)}~${pad3(r.to)}`;
}

export function rangeContains(r: IdRange, id: TestId): boolean {
  return id.prefix === r.prefix && id.num >= r.from && id.num <= r.to;
}

/** 범위의 모든 ID 문자열(큰 범위는 호출자가 책임). */
export function expandRange(r: IdRange): string[] {
  const out: string[] = [];
  for (let n = r.from; n <= r.to; n++) {
    out.push(`${r.prefix}-${pad3(n)}`);
  }
  return out;
}

const YAML_ITEM_RE = /^((?:UT|CT|SEC)-[A-Z]+|IT|E2E|CHA|PRF)-(\d{3})(?:~(\d{3}))?$/;

/** `UT-GATE-001~005`·`IT-003` 한 항목 → 범위. 형식이 아니면 null. */
export function parseRangeItem(text: string): IdRange | null {
  const m = YAML_ITEM_RE.exec(text.trim());
  if (!m) {
    return null;
  }
  const from = Number(m[2]);
  return { prefix: m[1] ?? '', from, to: m[3] !== undefined ? Number(m[3]) : from };
}

function stripItem(line: string): string {
  return line
    .replace(/^\s*-\s*/, '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/** ```yaml 블록들에서 `key:` 목록 항목을 읽는다. 키가 없으면 null. */
function yamlList(text: string, key: string): string[] | null {
  const blocks = [...text.matchAll(/```ya?ml\r?\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  let found = false;
  const items: string[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let inList = false;
    for (const line of lines) {
      if (new RegExp(`^\\s*${key}:\\s*$`).test(line)) {
        found = true;
        inList = true;
        continue;
      }
      if (inList) {
        if (/^\s*-\s+/.test(line)) {
          items.push(stripItem(line));
        } else if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
          // 목록 안의 빈 줄·주석은 건너뛴다
        } else {
          inList = false;
        }
      }
    }
  }
  return found ? items : null;
}

const PROSE_RE = /((?:UT|CT|SEC)-[A-Z]+|IT|E2E|CHA|PRF)-(\d{3})((?:·\d{3})*)(?:~(\d{3}))?/g;

/** 산문 안의 ID 표기(`UT-CON-001·002·003`, `UT-CON-010~099`)를 모두 범위로 바꾼다. */
export function parseProseRanges(text: string): IdRange[] {
  const out: IdRange[] = [];
  for (const m of text.matchAll(PROSE_RE)) {
    const prefix = m[1] ?? '';
    const nums = [Number(m[2]), ...(m[3] ?? '').split('·').filter(Boolean).map(Number)];
    const upper = m[4] !== undefined ? Number(m[4]) : null;
    const last = nums.pop();
    for (const n of nums) {
      out.push({ prefix, from: n, to: n });
    }
    if (last !== undefined) {
      out.push({ prefix, from: last, to: upper ?? last });
    }
  }
  return out;
}

/** §2·§3 안에서 `테스트 ID 범위`·`테스트:` 가 있는 줄의 산문 범위. */
function proseRanges(text: string): IdRange[] {
  let inScope = false;
  const out: IdRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      inScope = /^##\s+[23]\b/.test(line);
      continue;
    }
    if (inScope && (line.includes('테스트 ID 범위') || line.includes('테스트:'))) {
      out.push(...parseProseRanges(line));
    }
  }
  return out;
}

/** Brief 마크다운 → 범위·allowed_paths. `test_ids:` 가 없으면 산문 대체. */
export function parseBrief(file: string, text: string): BriefInfo {
  const taskId =
    /^#\s+Task Brief\s+(T-\d{2}-\d{2}[a-z0-9-]*)/m.exec(text)?.[1] ??
    /(T-\d{2}-\d{2}[a-z0-9-]*)\.md$/.exec(file)?.[1] ??
    file;
  const ids = yamlList(text, 'test_ids');
  const ranges: IdRange[] = [];
  if (ids !== null) {
    for (const item of ids) {
      const r = parseRangeItem(item);
      if (r) {
        ranges.push(r);
      }
    }
  } else {
    ranges.push(...proseRanges(text));
  }
  const paths = (yamlList(text, 'allowed_paths') ?? []).flatMap((p) => expandBraces(p));
  return { taskId, file, ranges, allowedPaths: paths, fromYaml: ids !== null };
}

export function countIds(ranges: IdRange[]): number {
  const seen = new Set<string>();
  for (const r of ranges) {
    for (let n = r.from; n <= r.to; n++) {
      seen.add(`${r.prefix}-${n}`);
    }
  }
  return seen.size;
}

/** ---- 위치 규칙 ---- */
export interface TestEntry {
  id: string;
  file: string;
  line: number;
}

export interface IdDiagnostic {
  file: string;
  line: number;
  rule: string;
  message: string;
}

const unitFromPath = (file: string): string | null => {
  const m = /^(apps|services|packages|tools)\/([^/]+)\//.exec(file);
  return m ? `${m[1]}/${m[2]}` : null;
};

const has = (file: string, seg: string): boolean => file.includes(`/${seg}/`);

/** 위치 규칙 위반 사유(없으면 null). D-P00-06: packages·tools 단위의 `test/integration/` UT 허용. */
export function locationProblem(entry: TestEntry): string | null {
  const t = parseTestId(entry.id);
  if (!t) {
    return null;
  }
  const f = entry.file;
  const unit = unitFromPath(f);
  const where = (expected: string): string => `${entry.id} must live in ${expected} (found ${f})`;
  const unitDir = t.unit !== null ? UNIT_DIR[t.unit] : undefined;
  switch (t.kind) {
    case 'UT': {
      if (unitDir !== undefined && unit !== null && unit !== unitDir) {
        return where(`${unitDir}/test/`);
      }
      const inDirs = ['unit', 'property', 'golden', 'component'].some((d) => has(f, `test/${d}`));
      const gateFlat = t.unit === 'GATE' && /^tools\/gates\/test\/[^/]+\.test\.mjs$/.test(f);
      const pkgIntegration =
        has(f, 'test/integration') && unit !== null && (unit.startsWith('packages/') || unit.startsWith('tools/'));
      return inDirs || gateFlat || pkgIntegration
        ? null
        : where('<unit>/test/{unit,property,golden,component}/ (packages·tools: test/integration/ allowed, D-P00-06)');
    }
    case 'CT': {
      if (t.unit === 'SYS') {
        return f.startsWith('tests/contract/') ? null : where('tests/contract/');
      }
      if (unitDir !== undefined && unit !== null && unit !== unitDir) {
        return where(`${unitDir}/test/contract/`);
      }
      return has(f, 'test/contract') ? null : where('<unit>/test/contract/');
    }
    case 'SEC': {
      if (t.unit === 'SYS') {
        return f.startsWith('tests/security/') ? null : where('tests/security/');
      }
      if (unitDir !== undefined && unit !== null && unit !== unitDir) {
        return where(`${unitDir}/test/security/`);
      }
      return has(f, 'test/security') ? null : where('<unit>/test/security/');
    }
    case 'IT': {
      const inService = unit?.startsWith('services/') === true && has(f, 'test/integration');
      // 확장(Brief 결정 아님): apps/cli·packages·tools 의 IT 대역(600~699)과 tools/gates/test/*.test.mjs(T-00-01 IT-655~659)
      const inCliOrTool =
        (unit === 'apps/cli' || unit?.startsWith('packages/') === true || unit?.startsWith('tools/') === true) &&
        has(f, 'test/integration');
      const gateFlat = /^tools\/gates\/test\/[^/]+\.test\.mjs$/.test(f);
      return inService || inCliOrTool || gateFlat || f.startsWith('tests/integration/')
        ? null
        : where('services/<svc>/test/integration/, tests/integration/ (or apps/cli·packages·tools test/integration/)');
    }
    case 'E2E':
      return f.startsWith('tests/e2e/') ? null : where('tests/e2e/');
    case 'CHA':
      return f.startsWith('tests/chaos/') ? null : where('tests/chaos/');
    case 'PRF':
      return f.startsWith('tests/perf/') ? null : where('tests/perf/');
  }
}

/** IT 번호가 위치 대역 안인가(TST §11.2). */
export function itBandProblem(entry: TestEntry): string | null {
  const t = parseTestId(entry.id);
  if (t?.kind !== 'IT') {
    return null;
  }
  const f = entry.file;
  const svc = /^services\/([^/]+)\//.exec(f)?.[1];
  const bands: Record<string, [number, number]> = {
    gateway: [100, 199],
    content: [200, 299],
    learning: [300, 399],
    'ai-gateway': [400, 499],
    ops: [500, 599],
  };
  let band: [number, number] | undefined;
  let label = '';
  if (f.startsWith('tests/integration/')) {
    band = [1, 99];
    label = 'tests/integration (001~099)';
  } else if (svc !== undefined && bands[svc] !== undefined) {
    band = bands[svc];
    label = `services/${svc} (${band?.[0]}~${band?.[1]})`;
  } else if (f.startsWith('apps/cli/')) {
    band = [600, 649];
    label = 'apps/cli (600~649)';
  } else if (f.startsWith('tools/') || f.startsWith('packages/')) {
    band = [650, 699];
    label = 'packages·tools (650~699)';
  }
  if (band === undefined || (t.num >= band[0] && t.num <= band[1])) {
    return null;
  }
  return `${entry.id} is outside the band for ${label}`;
}

/** 같은 ID가 2번 이상(저장소 전체)일 때의 진단(각 위치에 1건). */
export function duplicateProblems(entries: TestEntry[]): IdDiagnostic[] {
  const byId = new Map<string, TestEntry[]>();
  for (const e of entries) {
    byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  }
  const out: IdDiagnostic[] = [];
  for (const [id, list] of [...byId].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (list.length < 2) {
      continue;
    }
    const where = list.map((e) => `${e.file}:${e.line}`).join(', ');
    for (const e of list) {
      out.push({
        file: e.file,
        line: e.line,
        rule: 'si/duplicate-id',
        message: `${id} appears ${list.length} times: ${where}`,
      });
    }
  }
  return out;
}

/** `--task`: Brief allowed_paths에 맞는 테스트 파일의 ID가 Brief 범위 밖이면 진단. */
export function outOfRangeProblems(entries: TestEntry[], brief: BriefInfo): IdDiagnostic[] {
  const out: IdDiagnostic[] = [];
  for (const e of entries) {
    if (!matchAny(e.file, brief.allowedPaths)) {
      continue;
    }
    const t = parseTestId(e.id);
    if (!t || brief.ranges.some((r) => rangeContains(r, t))) {
      continue;
    }
    out.push({
      file: e.file,
      line: e.line,
      rule: 'si/out-of-range',
      message: `${e.id} is outside the ID ranges assigned to ${brief.taskId}`,
    });
  }
  return out;
}

/** Brief 사이의 같은 ID 범위 겹침. */
export function overlapProblems(briefs: BriefInfo[]): IdDiagnostic[] {
  const out: IdDiagnostic[] = [];
  for (let i = 0; i < briefs.length; i++) {
    for (let j = i + 1; j < briefs.length; j++) {
      const a = briefs[i];
      const b = briefs[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      for (const ra of a.ranges) {
        for (const rb of b.ranges) {
          if (ra.prefix !== rb.prefix) {
            continue;
          }
          const from = Math.max(ra.from, rb.from);
          const to = Math.min(ra.to, rb.to);
          if (from <= to) {
            out.push({
              file: a.file,
              line: 0,
              rule: 'si/range-overlap',
              message: `${a.taskId} and ${b.taskId} both include ${formatRange({ prefix: ra.prefix, from, to })}`,
            });
          }
        }
      }
    }
  }
  return out;
}

/** 위치 규칙 + IT 대역 진단 모음. */
export function placementProblems(entries: TestEntry[]): IdDiagnostic[] {
  const out: IdDiagnostic[] = [];
  for (const e of entries) {
    const loc = locationProblem(e);
    if (loc !== null) {
      out.push({ file: e.file, line: e.line, rule: 'si/id-location', message: loc });
    }
    const band = itBandProblem(e);
    if (band !== null) {
      out.push({ file: e.file, line: e.line, rule: 'si/it-band', message: band });
    }
  }
  return out;
}
