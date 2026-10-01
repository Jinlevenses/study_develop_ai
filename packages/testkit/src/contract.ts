import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CallerName, ServiceName } from '@fathom/contracts/common/ids';
import { Problem } from '@fathom/contracts/common/problem';
import type { HttpMethod, RouteDef } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeClock } from './clock.js';
import type { Mutation } from './contract-arbitrary.js';
import { deriveMutations, toJsonSchema } from './contract-arbitrary.js';
import type { PeerClientPort } from './fakes/peers/peers.js';
import { createUlidSequence } from './ids.js';

// TST-01 §6.2 — 라우트 적합성 하네스. 순수 검사기(`checkRouteTable`·`checkRouteContract`) + 얇은 vitest 래퍼(`describeRouteContracts`).

export type InjectRequest = { method: HttpMethod; url: string; headers: Record<string, string>; payload?: string };
export type InjectResponse = { statusCode: number; headers: Record<string, unknown>; body: string };
/** Fastify 인스턴스가 구조적으로 만족한다. */
export interface Injector {
  inject(req: InjectRequest): Promise<InjectResponse>;
}
export interface ContractApp {
  app: Injector;
  registeredRoutes(): ReadonlyArray<{ method: string; url: string }>;
  close(): Promise<void>;
}
export type ContractBuildDeps = {
  callerTokens: Readonly<Record<ServiceName, string>>;
  peers: Readonly<Partial<Record<ServiceName, PeerClientPort>>>;
  clock: Clock;
};

export const TEST_CALLER_TOKENS: Readonly<Record<ServiceName, string>> = {
  gateway: '1'.repeat(64),
  content: '2'.repeat(64),
  learning: '3'.repeat(64),
  'ai-gateway': '4'.repeat(64),
  'ops-api': '5'.repeat(64),
};

export const RouteFixture = S({
  request: S({
    params: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.unknown()).optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  caller: CallerName,
  expect: S({ status: z.number().int() }),
});
export type RouteFixture = z.infer<typeof RouteFixture>;

export type ContractViolation = {
  rule: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';
  route_id: string;
  detail: string;
};

export type PublicAuth = { headersFor(caller: 'browser' | 'cli'): Promise<Record<string, string>> };
export type CheckOptions = {
  callerTokens: Readonly<Record<ServiceName, string>>;
  /** 기대 응답 서비스 코드(`GW`·`CT`·`LR`·`AI`·`OP`). 없으면 5종 모두 허용. */
  svcCode?: string;
  preSubmitSchemas?: readonly z.ZodType[];
  publicAuth?: PublicAuth;
  /** 검사기가 건너뛴 하위 검사의 사유를 덧붙이는 출력 배열(위반이 아님). */
  notes?: string[];
};

export const PRE_SUBMIT_FORBIDDEN = [
  'answer_key',
  'explanation',
  'is_correct',
  'model_answer',
  'exemplar_note',
  'solution',
] as const; // + 접두 'correct_'
const PRE_SUBMIT_FORBIDDEN_SET: ReadonlySet<string> = new Set(PRE_SUBMIT_FORBIDDEN);

// ---------------------------------------------------------------------------------------------------------------------
// C1 — 라우트 표 양방향 비교

const IGNORED_METHODS: ReadonlySet<string> = new Set(['HEAD', 'OPTIONS']);

/** Fastify 표기(`:name`, 이스케이프된 `::`) → contracts 표기(`{name}`, `:`). */
function normalizeFastifyPath(url: string): string {
  const colon = '\u0000';
  return url
    .replaceAll('::', colon)
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
    .replaceAll(colon, ':');
}

function tableKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function checkRouteTable(
  routes: readonly RouteDef[],
  registered: ReadonlyArray<{ method: string; url: string }>,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const registeredKeys = new Set(
    registered
      .filter((r) => !IGNORED_METHODS.has(r.method.toUpperCase()))
      .map((r) => tableKey(r.method, normalizeFastifyPath(r.url))),
  );
  const contractKeys = new Set(routes.map((r) => tableKey(r.method, r.path)));
  for (const route of routes) {
    if (!registeredKeys.has(tableKey(route.method, route.path))) {
      violations.push({ rule: 'C1', route_id: route.id, detail: `not registered: ${route.method} ${route.path}` });
    }
  }
  for (const key of [...registeredKeys].sort()) {
    if (!contractKeys.has(key)) {
      violations.push({ rule: 'C1', route_id: key, detail: `registered but not in contracts: ${key}` });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------------
// C9 — pre-submit 금지 필드

function collectForbidden(node: unknown, trail: readonly string[], out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectForbidden(item, trail, out);
    }
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [name, child] of Object.entries(value)) {
        const here = [...trail, name];
        if (isForbiddenName(name)) {
          out.add(here.join('.'));
        }
        collectForbidden(child, here, out);
      }
    } else if (key === 'required' && Array.isArray(value)) {
      for (const name of value) {
        if (typeof name === 'string' && isForbiddenName(name)) {
          out.add([...trail, name].join('.'));
        }
      }
    } else {
      collectForbidden(value, key === 'items' ? [...trail, '[]'] : trail, out);
    }
  }
}

function isForbiddenName(name: string): boolean {
  return PRE_SUBMIT_FORBIDDEN_SET.has(name) || name.startsWith('correct_');
}

/** JSON Schema 전체를 순회해 금지 필드 경로(`a.b.correct_option`)를 돌려준다. */
export function findForbiddenFields(schema: z.ZodType): string[] {
  const found = new Set<string>();
  collectForbidden(toJsonSchema(schema), [], found);
  return [...found].sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// 요청 조립

type Probe = {
  readonly route: RouteDef;
  readonly app: Injector;
  readonly fixture: RouteFixture;
  readonly opts: CheckOptions;
  readonly violations: ContractViolation[];
  readonly errorResponses: InjectResponse[];
  readonly nextKey: () => string;
};

type SendSpec = {
  /** `null` = 자격 증명 없음. */
  caller: CallerName | null;
  body?: unknown;
  query?: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
  /** `undefined` = 새 키 자동 부여(멱등 라우트), `null` = 키 없음. */
  idemKey?: string | null;
};

function violate(probe: Probe, rule: ContractViolation['rule'], detail: string): void {
  probe.violations.push({ rule, route_id: probe.route.id, detail });
}

function expandPath(path: string, params: Readonly<Record<string, string>> | undefined): string | null {
  let missing = false;
  const url = path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return encodeURIComponent(value);
  });
  return missing ? null : url;
}

function queryString(query: Readonly<Record<string, unknown>> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function headerOf(res: InjectResponse, name: string): string | undefined {
  for (const [key, value] of Object.entries(res.headers)) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : String(value);
    }
  }
  return undefined;
}

async function authHeaders(probe: Probe, caller: CallerName | null): Promise<Record<string, string>> {
  if (caller === null) {
    return {};
  }
  const service = ServiceName.safeParse(caller);
  if (service.success) {
    return { authorization: `Bearer ${probe.opts.callerTokens[service.data]}` };
  }
  return (await probe.opts.publicAuth?.headersFor(caller === 'cli' ? 'cli' : 'browser')) ?? {};
}

async function send(probe: Probe, spec: SendSpec): Promise<InjectResponse> {
  const { route, fixture } = probe;
  const url = expandPath(route.path, fixture.request.params);
  if (url === null) {
    throw new Error(`fixture for ${route.id} lacks a path param of ${route.path}`);
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(fixture.request.headers ?? {})) {
    if (spec.caller === null && ['authorization', 'cookie'].includes(name.toLowerCase())) {
      continue;
    }
    headers[name.toLowerCase()] = value;
  }
  Object.assign(headers, await authHeaders(probe, spec.caller));
  const payload = spec.body === undefined ? undefined : JSON.stringify(spec.body);
  if (payload !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
  }
  if (route.idempotent && spec.idemKey !== null) {
    headers['idempotency-key'] = spec.idemKey ?? probe.nextKey();
  }
  Object.assign(headers, Object.fromEntries(Object.entries(spec.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])));
  const request: InjectRequest = { method: route.method, url: `${url}${queryString(spec.query)}`, headers };
  if (payload !== undefined) {
    request.payload = payload;
  }
  const res = await probe.app.inject(request);
  if (res.statusCode >= 400 && route.response[res.statusCode] === undefined) {
    probe.errorResponses.push(res);
  }
  return res;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function problemCode(res: InjectResponse): string | undefined {
  const parsed = parseJson(res.body);
  if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null && 'code' in parsed.value) {
    return typeof parsed.value.code === 'string' ? parsed.value.code : undefined;
  }
  return undefined;
}

const SVC_CODES: ReadonlySet<string> = new Set(['GW', 'CT', 'LR', 'AI', 'OP']);

function codeMatches(probe: Probe, res: InjectResponse, category: string, numbers: string): boolean {
  const code = probe.opts.svcCode;
  if (code !== undefined && !SVC_CODES.has(code)) {
    throw new Error(`invariant: svcCode must be one of GW|CT|LR|AI|OP, got ${code}`);
  }
  const svc = code ?? '(?:GW|CT|LR|AI|OP)';
  return new RegExp(`^${svc}-${category}-${numbers}$`).test(problemCode(res) ?? '');
}

function expectProblem(
  probe: Probe,
  rule: ContractViolation['rule'],
  label: string,
  res: InjectResponse,
  status: number,
  category: string,
  numbers: string,
): void {
  if (res.statusCode !== status || !codeMatches(probe, res, category, numbers)) {
    violate(
      probe,
      rule,
      `${label}: expected ${status} ${category}-${numbers}, got ${res.statusCode} ${problemCode(res) ?? '(no code)'}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C2·C8

function summarize(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function checkPagination(probe: Probe, body: unknown): void {
  if (Array.isArray(body)) {
    violate(probe, 'C8', 'top-level array response');
    return;
  }
  if (probe.route.paginated) {
    const ok =
      typeof body === 'object' &&
      body !== null &&
      'items' in body &&
      Array.isArray(body.items) &&
      'next_cursor' in body;
    if (!ok) {
      violate(probe, 'C8', 'paginated response lacks items[] / next_cursor');
    }
  }
}

async function checkFixtureResponse(probe: Probe): Promise<void> {
  const { route, fixture } = probe;
  const res = await send(probe, { caller: fixture.caller, body: fixture.request.body, query: fixture.request.query });
  const status = fixture.expect.status;
  if (res.statusCode !== status) {
    violate(probe, 'C2', `fixture request: expected ${status}, got ${res.statusCode}`);
    return;
  }
  const schema = route.response[status];
  if (schema === undefined) {
    violate(probe, 'C2', `status ${status} is not declared in route.response`);
    return;
  }
  if (status === 204) {
    if (res.body !== '') {
      violate(probe, 'C2', '204 response has a body');
    }
    return;
  }
  const kind = route.responseKind ?? 'json';
  if (kind === 'sse' || kind === 'ndjson') {
    return;
  }
  const payload: unknown = kind === 'text' ? res.body : undefined;
  let value = payload;
  if (kind === 'json') {
    const parsed = parseJson(res.body);
    if (!parsed.ok) {
      violate(probe, 'C2', 'response body is not JSON');
      return;
    }
    value = parsed.value;
    checkPagination(probe, value);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    violate(probe, 'C2', `response does not match route.response[${status}]: ${summarize(result.error)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function checkMutations(probe: Probe): Promise<void> {
  const { route, fixture } = probe;
  const targets: { target: 'body' | 'query'; mutation: Mutation }[] = [];
  const bodySchema = route.request.body;
  if (bodySchema !== undefined && route.request.bodyKind !== 'ndjson' && isRecord(fixture.request.body)) {
    for (const mutation of deriveMutations(bodySchema, fixture.request.body)) {
      targets.push({ target: 'body', mutation });
    }
  }
  const querySchema = route.request.query;
  if (querySchema !== undefined) {
    for (const mutation of deriveMutations(querySchema, fixture.request.query ?? {})) {
      if (mutation.kind !== 'type_violation') {
        targets.push({ target: 'query', mutation }); // 쿼리 값은 문자열이라 타입 변이는 무의미
      }
    }
  }
  for (const { target, mutation } of targets) {
    const res = await send(probe, {
      caller: fixture.caller,
      body: target === 'body' ? mutation.mutated : fixture.request.body,
      query: target === 'query' ? mutation.mutated : fixture.request.query,
    });
    expectProblem(probe, 'C3', `${target} ${mutation.kind}(${mutation.key})`, res, 400, 'VAL', '9\\d\\d');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C4

async function checkAuth(probe: Probe): Promise<void> {
  const { route, fixture } = probe;
  const base = { body: fixture.request.body, query: fixture.request.query };
  const allowed: readonly CallerName[] = route.allowedCallers;
  if (route.path.startsWith('/internal/v1/')) {
    expectProblem(probe, 'C4', 'no token', await send(probe, { caller: null, ...base }), 401, 'AUTH', '900');
    for (const service of ServiceName.options) {
      if (!allowed.includes(service)) {
        const res = await send(probe, { caller: service, ...base });
        expectProblem(probe, 'C4', `caller ${service} outside allowedCallers`, res, 403, 'ACL', '900');
      }
    }
    for (const caller of allowed) {
      if (ServiceName.safeParse(caller).success) {
        const res = await send(probe, { caller, ...base });
        if (res.statusCode < 200 || res.statusCode > 299) {
          violate(probe, 'C4', `allowed caller ${caller}: expected 2xx, got ${res.statusCode}`);
        }
      }
    }
    return;
  }
  for (const caller of ['browser', 'cli'] as const) {
    const res = await send(probe, { caller, ...base });
    const ok = allowed.includes(caller)
      ? res.statusCode >= 200 && res.statusCode <= 299
      : [401, 403].includes(res.statusCode);
    if (!ok) {
      violate(
        probe,
        'C4',
        `public caller ${caller} (${allowed.includes(caller) ? 'allowed' : 'not allowed'}): got ${res.statusCode}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C5

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** JSON Schema 안의 모든 문자열 enum·const 값을 모은다(열거형 잎의 대체 값 후보). */
function collectEnumValues(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectEnumValues(item, out);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' && Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string') {
          out.add(v);
        }
      }
    } else if (key === 'const' && typeof value === 'string') {
      out.add(value);
    } else {
      collectEnumValues(value, out);
    }
  }
}

function stringAlternatives(node: string, enums: readonly string[]): string[] {
  const alternatives = [`${node}a`];
  if (ULID_SHAPE.test(node)) {
    alternatives.push(`${node.slice(0, -1)}${node.endsWith('0') ? '1' : '0'}`);
  }
  for (const value of enums) {
    if (value !== node) {
      alternatives.push(value);
    }
  }
  return alternatives;
}

/**
 * 같은 키·다른 본문 변이를 만든다. 요청 본문 스키마를 통과하는 변이만 남겨, 본문 검증을 먼저 하는 적합 서버가
 * 400을 돌려주는 경우를 C5 위반으로 오판하지 않는다.
 */
function perturbations(body: unknown, schema: z.ZodType | undefined): unknown[] {
  const enums = new Set<string>();
  if (schema !== undefined) {
    collectEnumValues(toJsonSchema(schema, 'input'), enums);
  }
  const variants: unknown[] = [];
  const accept = (candidate: unknown): void => {
    if (variants.length < 12 && (schema === undefined || schema.safeParse(candidate).success)) {
      variants.push(candidate);
    }
  };
  const visit = (node: unknown, rebuild: (replacement: unknown) => unknown): void => {
    if (variants.length >= 12) {
      return;
    }
    if (typeof node === 'string') {
      for (const alt of stringAlternatives(node, [...enums].sort())) {
        accept(rebuild(alt));
      }
    } else if (typeof node === 'number') {
      accept(rebuild(node + 1));
      accept(rebuild(node - 1));
    } else if (typeof node === 'boolean') {
      accept(rebuild(!node));
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => {
        visit(child, (r) => rebuild(node.map((c, i) => (i === index ? r : c))));
      });
    } else if (isRecord(node)) {
      for (const key of Object.keys(node).sort()) {
        visit(node[key], (r) => rebuild({ ...node, [key]: r }));
      }
    }
  };
  visit(body, (r) => r);
  return variants;
}

function sameBody(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const left = parseJson(a);
  const right = parseJson(b);
  return left.ok && right.ok && canonicalJson(left.value) === canonicalJson(right.value);
}

async function checkIdempotency(probe: Probe): Promise<void> {
  const { fixture } = probe;
  const base = { caller: fixture.caller, query: fixture.request.query };
  const missing = await send(probe, { ...base, body: fixture.request.body, idemKey: null });
  expectProblem(probe, 'C5', 'missing Idempotency-Key', missing, 400, 'VAL', '901');
  const key = probe.nextKey();
  const first = await send(probe, { ...base, body: fixture.request.body, idemKey: key });
  if (first.statusCode !== fixture.expect.status) {
    violate(probe, 'C5', `first keyed request: expected ${fixture.expect.status}, got ${first.statusCode}`);
    return;
  }
  if (fixture.request.body !== undefined) {
    let conflict = false;
    const variants = perturbations(fixture.request.body, probe.route.request.body);
    for (const variant of variants) {
      const res = await send(probe, { ...base, body: variant, idemKey: key });
      if (res.statusCode === 422 && codeMatches(probe, res, 'CONFLICT', '001')) {
        conflict = true;
        break;
      }
    }
    if (variants.length === 0) {
      probe.opts.notes?.push(
        `C5 conflict sub-check skipped for ${probe.route.id}: no schema-valid body variant exists`,
      );
    } else if (!conflict) {
      violate(probe, 'C5', 'same key with a different body did not yield 422 CONFLICT-001');
    }
  }
  const replay = await send(probe, { ...base, body: fixture.request.body, idemKey: key });
  if (replay.statusCode !== first.statusCode || !sameBody(replay.body, first.body)) {
    violate(probe, 'C5', `replay differs from original (status ${first.statusCode} -> ${replay.statusCode})`);
  }
  if (headerOf(replay, 'idempotent-replayed') !== 'true') {
    violate(probe, 'C5', 'replayed response lacks idempotent-replayed: true');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// C6·C7·C9

const FORBIDDEN_IN_ERRORS: readonly string[] = ['    at ', '/home/', '/Users/', 'C:\\', 'SELECT ', 'INSERT '];

function problemShapeIssues(res: InjectResponse): string[] {
  const issues: string[] = [];
  if (!(headerOf(res, 'content-type') ?? '').toLowerCase().startsWith('application/problem+json')) {
    issues.push(`content-type is ${headerOf(res, 'content-type') ?? '(none)'}`);
  }
  const parsed = parseJson(res.body);
  if (!parsed.ok) {
    issues.push('body is not JSON');
  } else {
    const problem = Problem.safeParse(parsed.value);
    if (!problem.success) {
      issues.push(`not a Problem: ${summarize(problem.error)}`);
    } else if (problem.data.type !== `urn:fathom:problem:${problem.data.code.toLowerCase()}`) {
      issues.push(`type ${problem.data.type} does not match code ${problem.data.code}`);
    }
  }
  for (const needle of FORBIDDEN_IN_ERRORS) {
    if (res.body.includes(needle)) {
      issues.push(`body leaks ${JSON.stringify(needle)}`);
    }
  }
  return issues;
}

async function checkDeadline(probe: Probe): Promise<void> {
  const { fixture } = probe;
  const res = await send(probe, {
    caller: fixture.caller,
    body: fixture.request.body,
    query: fixture.request.query,
    headers: { 'x-fathom-deadline-ms': '0' },
  });
  expectProblem(probe, 'C7', 'x-fathom-deadline-ms: 0', res, 504, 'DEP', '902');
}

function checkPreSubmit(probe: Probe): void {
  for (const schema of Object.values(probe.route.response)) {
    if (probe.opts.preSubmitSchemas?.some((candidate) => Object.is(candidate, schema)) === true) {
      const forbidden = findForbiddenFields(schema);
      if (forbidden.length > 0) {
        violate(probe, 'C9', `pre-submit response exposes ${forbidden.join(', ')}`);
      }
    }
  }
}

/** 라우트 1개의 C2~C9를 단언한다(C1은 `checkRouteTable`). 위반 목록(빈 배열 = 적합)을 돌려준다. */
export async function checkRouteContract(
  route: RouteDef,
  app: Injector,
  fixture: RouteFixture,
  opts: CheckOptions,
): Promise<ContractViolation[]> {
  const nextId = createUlidSequence(1);
  const probe: Probe = { route, app, fixture, opts, violations: [], errorResponses: [], nextKey: nextId };
  await checkFixtureResponse(probe);
  await checkMutations(probe);
  const isHealth = route.path === '/healthz' || route.path === '/readyz';
  if (!isHealth && (route.path.startsWith('/internal/v1/') || opts.publicAuth !== undefined)) {
    await checkAuth(probe);
  }
  if (route.idempotent) {
    await checkIdempotency(probe);
  }
  await checkDeadline(probe);
  checkPreSubmit(probe);
  const seen = new Set<string>();
  for (const res of probe.errorResponses) {
    for (const issue of problemShapeIssues(res)) {
      const detail = `${res.statusCode}: ${issue}`;
      if (!seen.has(detail)) {
        seen.add(detail);
        violate(probe, 'C6', detail);
      }
    }
  }
  return probe.violations;
}

// ---------------------------------------------------------------------------------------------------------------------
// vitest 래퍼

function isRouteDef(value: unknown): value is RouteDef {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.ifId === 'string' &&
    typeof value.method === 'string' &&
    typeof value.path === 'string' &&
    Array.isArray(value.allowedCallers) &&
    isRecord(value.response)
  );
}

/** groups 모듈의 export 중 `ifId`·`method`·`path`를 가진 객체(배열 안의 것 포함)를 id 중복 없이 모은다. */
export function collectRoutes(groups: readonly Record<string, unknown>[]): RouteDef[] {
  const byId = new Map<string, RouteDef>();
  for (const group of groups) {
    for (const value of Object.values(group)) {
      for (const candidate of Array.isArray(value) ? value : [value]) {
        if (isRouteDef(candidate) && !byId.has(candidate.id)) {
          byId.set(candidate.id, candidate);
        }
      }
    }
  }
  return [...byId.values()];
}

/** TST §6.3: 서비스 IF는 `<unit>-nnn`, 공통 IF-COM-nnn은 `<unit>-6nn`으로 배정해 같은 번호가 겹치지 않게 한다. */
export function ifNumber(route: RouteDef): string {
  const digits = (/(\d+)$/.exec(route.ifId)?.[1] ?? '0').padStart(3, '0');
  return route.ifId.startsWith('IF-COM-') ? `6${digits.slice(-2)}` : digits;
}

async function loadFixture(dir: URL, route: RouteDef): Promise<RouteFixture> {
  const file = fileURLToPath(new URL(`${route.id}.json`, dir));
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (cause) {
    throw new Error(`route fixture missing for ${route.id}: ${file}`, { cause });
  }
  return RouteFixture.parse(JSON.parse(text));
}

export type RouteContractsConfig = {
  unit: string;
  build: (d: ContractBuildDeps) => Promise<ContractApp>;
  groups: readonly Record<string, unknown>[];
  fixtures: URL;
  preSubmitSchemas?: readonly z.ZodType[];
  publicAuth?: PublicAuth;
};

export type RouteContractCase = { title: string; run: () => Promise<void> };
export type RouteContractPlan = {
  setup(): Promise<void>;
  teardown(): Promise<void>;
  cases: readonly RouteContractCase[];
};

/**
 * 라우트 적합성 케이스를 만든다(vitest에 등록하지 않는다). `describeRouteContracts`가 이를 `it`으로 등록하고,
 * 하네스 자가 테스트는 직접 실행해 `CT-<unit>-nnn` 제목이 vitest 결과에 새지 않게 한다(RTM 오집계 방지).
 */
export function planRouteContracts(cfg: RouteContractsConfig): RouteContractPlan {
  if (!SVC_CODES.has(cfg.unit)) {
    throw new Error(`invariant: unit must be one of GW|CT|LR|AI|OP, got ${cfg.unit}`);
  }
  const routes = collectRoutes(cfg.groups);
  let built: ContractApp | undefined;
  const app = (): ContractApp => {
    if (built === undefined) {
      throw new Error('invariant: contract app not built');
    }
    return built;
  };
  const cases: RouteContractCase[] = [
    {
      title: `CT-${cfg.unit}-000 등록된 라우트 표가 계약과 양방향으로 일치한다 [C1][IR-015]`,
      run: (): Promise<void> => {
        const violations = checkRouteTable(routes, app().registeredRoutes());
        expect(violations).toEqual([]);
        return Promise.resolve();
      },
    },
  ];
  for (const route of routes) {
    cases.push({
      title: `CT-${cfg.unit}-${ifNumber(route)} 라우트 ${route.id}가 계약을 지킨다 [${route.ifId}]`,
      run: async (): Promise<void> => {
        const fixture = await loadFixture(cfg.fixtures, route);
        const options: CheckOptions = { callerTokens: TEST_CALLER_TOKENS, svcCode: cfg.unit };
        if (cfg.preSubmitSchemas !== undefined) {
          options.preSubmitSchemas = cfg.preSubmitSchemas;
        }
        if (cfg.publicAuth !== undefined) {
          options.publicAuth = cfg.publicAuth;
        }
        expect(await checkRouteContract(route, app().app, fixture, options)).toEqual([]);
      },
    });
  }
  return {
    setup: async (): Promise<void> => {
      built = await cfg.build({ callerTokens: TEST_CALLER_TOKENS, peers: {}, clock: createFakeClock() });
    },
    teardown: async (): Promise<void> => {
      await built?.close();
    },
    cases,
  };
}

export function describeRouteContracts(cfg: RouteContractsConfig): void {
  const plan = planRouteContracts(cfg);
  describe(`route contracts [${cfg.unit}]`, () => {
    beforeAll(plan.setup);
    afterAll(plan.teardown);
    for (const c of plan.cases) {
      it(c.title, c.run);
    }
  });
}
