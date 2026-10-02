import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as adminRoutes from '@fathom/contracts/admin/admin-routes';
import { SVC_CODE_OF } from '@fathom/contracts/common/errors';
import type { CallerName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import * as inboxRoutes from '@fathom/contracts/events/inbox';
import { CONTRACTS_HASH } from '@fathom/contracts/events/registry.gen';
import * as g_ai_gateway_calibration from '@fathom/contracts/http/ai-gateway/v1/calibration';
import * as g_ai_gateway_errors from '@fathom/contracts/http/ai-gateway/v1/errors';
import * as g_ai_gateway_firewall from '@fathom/contracts/http/ai-gateway/v1/firewall';
import * as g_ai_gateway_generate from '@fathom/contracts/http/ai-gateway/v1/generate';
import * as g_ai_gateway_jobs from '@fathom/contracts/http/ai-gateway/v1/jobs';
import * as g_ai_gateway_judge from '@fathom/contracts/http/ai-gateway/v1/judge';
import * as g_ai_gateway_mode from '@fathom/contracts/http/ai-gateway/v1/mode';
import * as g_ai_gateway_providers from '@fathom/contracts/http/ai-gateway/v1/providers';
import * as g_ai_gateway_secrets from '@fathom/contracts/http/ai-gateway/v1/secrets';
import * as g_ai_gateway_streams from '@fathom/contracts/http/ai-gateway/v1/streams';
import * as g_ai_gateway_usage from '@fathom/contracts/http/ai-gateway/v1/usage';
import * as g_ai_gateway_work_orders from '@fathom/contracts/http/ai-gateway/v1/work-orders';
import * as g_content_acquisition from '@fathom/contracts/http/content/v1/acquisition';
import * as g_content_catalog from '@fathom/contracts/http/content/v1/catalog';
import * as g_content_errors from '@fathom/contracts/http/content/v1/errors';
import * as g_content_grading from '@fathom/contracts/http/content/v1/grading';
import * as g_content_itembank from '@fathom/contracts/http/content/v1/itembank';
import * as g_content_overlays from '@fathom/contracts/http/content/v1/overlays';
import * as g_content_runner from '@fathom/contracts/http/content/v1/runner';
import * as g_gateway_ai from '@fathom/contracts/http/gateway/v1/ai';
import * as g_gateway_cli from '@fathom/contracts/http/gateway/v1/cli';
import * as g_gateway_concepts from '@fathom/contracts/http/gateway/v1/concepts';
import * as g_gateway_curation from '@fathom/contracts/http/gateway/v1/curation';
import * as g_gateway_dialogs from '@fathom/contracts/http/gateway/v1/dialogs';
import * as g_gateway_errors from '@fathom/contracts/http/gateway/v1/errors';
import * as g_gateway_evidence from '@fathom/contracts/http/gateway/v1/evidence';
import * as g_gateway_home from '@fathom/contracts/http/gateway/v1/home';
import * as g_gateway_imports from '@fathom/contracts/http/gateway/v1/imports';
import * as g_gateway_inbox from '@fathom/contracts/http/gateway/v1/inbox';
import * as g_gateway_internal from '@fathom/contracts/http/gateway/v1/internal';
import * as g_gateway_longtasks from '@fathom/contracts/http/gateway/v1/longtasks';
import * as g_gateway_map from '@fathom/contracts/http/gateway/v1/map';
import * as g_gateway_ops from '@fathom/contracts/http/gateway/v1/ops';
import * as g_gateway_practice_items from '@fathom/contracts/http/gateway/v1/practice-items';
import * as g_gateway_review from '@fathom/contracts/http/gateway/v1/review';
import * as g_gateway_session from '@fathom/contracts/http/gateway/v1/session';
import * as g_gateway_sessions from '@fathom/contracts/http/gateway/v1/sessions';
import * as g_gateway_settings from '@fathom/contracts/http/gateway/v1/settings';
import * as g_gateway_stream from '@fathom/contracts/http/gateway/v1/stream';
import * as g_learning_attempts from '@fathom/contracts/http/learning/v1/attempts';
import * as g_learning_dialogs from '@fathom/contracts/http/learning/v1/dialogs';
import * as g_learning_errors from '@fathom/contracts/http/learning/v1/errors';
import * as g_learning_insight from '@fathom/contracts/http/learning/v1/insight';
import * as g_learning_learner from '@fathom/contracts/http/learning/v1/learner';
import * as g_learning_ledger from '@fathom/contracts/http/learning/v1/ledger';
import * as g_learning_longtasks from '@fathom/contracts/http/learning/v1/longtasks';
import * as g_learning_notes from '@fathom/contracts/http/learning/v1/notes';
import * as g_learning_seasons from '@fathom/contracts/http/learning/v1/seasons';
import * as g_learning_sessions from '@fathom/contracts/http/learning/v1/sessions';
import * as g_learning_settings from '@fathom/contracts/http/learning/v1/settings';
import * as g_learning_telemetry from '@fathom/contracts/http/learning/v1/telemetry';
import * as g_ops_autostart from '@fathom/contracts/http/ops/v1/autostart';
import * as g_ops_backups from '@fathom/contracts/http/ops/v1/backups';
import * as g_ops_doctor from '@fathom/contracts/http/ops/v1/doctor';
import * as g_ops_errors from '@fathom/contracts/http/ops/v1/errors';
import * as g_ops_health from '@fathom/contracts/http/ops/v1/health';
import * as g_ops_logs from '@fathom/contracts/http/ops/v1/logs';
import * as g_ops_operations from '@fathom/contracts/http/ops/v1/operations';
import * as g_ops_system from '@fathom/contracts/http/ops/v1/system';
import * as g_ops_telemetry from '@fathom/contracts/http/ops/v1/telemetry';
import * as g_ops_timeline from '@fathom/contracts/http/ops/v1/timeline';
import * as g_ops_transfer from '@fathom/contracts/http/ops/v1/transfer';
import * as g_ops_upgrade from '@fathom/contracts/http/ops/v1/upgrade';
import { collectRoutes, TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import type { StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, migrateHome } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAlive, launchDirect, reportDir } from '../support/direct-stack.js';

// CT-SYS-003 — 호출자 × 라우트 행렬이 allowedCallers와 일치한다(ARC-01 §5.2, IF-01 §2.11, TST-01 §11.4).
// 라우트 수집: contracts http/<svc>/v1/*.ts 전부(하위 pre-/post-submit 제외)를 정적 namespace import로 나열하고,
// 테스트가 fs로 같은 디렉터리를 다시 나열해 GROUPS와 같은지 단언한다(새 그룹 파일 = 실패 → import 추가).

type Group = readonly [StackService, string, Record<string, unknown>];
const GROUPS: readonly Group[] = [
  ['gateway', '@fathom/contracts/http/gateway/v1/ai', g_gateway_ai],
  ['gateway', '@fathom/contracts/http/gateway/v1/cli', g_gateway_cli],
  ['gateway', '@fathom/contracts/http/gateway/v1/concepts', g_gateway_concepts],
  ['gateway', '@fathom/contracts/http/gateway/v1/curation', g_gateway_curation],
  ['gateway', '@fathom/contracts/http/gateway/v1/dialogs', g_gateway_dialogs],
  ['gateway', '@fathom/contracts/http/gateway/v1/errors', g_gateway_errors],
  ['gateway', '@fathom/contracts/http/gateway/v1/evidence', g_gateway_evidence],
  ['gateway', '@fathom/contracts/http/gateway/v1/home', g_gateway_home],
  ['gateway', '@fathom/contracts/http/gateway/v1/imports', g_gateway_imports],
  ['gateway', '@fathom/contracts/http/gateway/v1/inbox', g_gateway_inbox],
  ['gateway', '@fathom/contracts/http/gateway/v1/internal', g_gateway_internal],
  ['gateway', '@fathom/contracts/http/gateway/v1/longtasks', g_gateway_longtasks],
  ['gateway', '@fathom/contracts/http/gateway/v1/map', g_gateway_map],
  ['gateway', '@fathom/contracts/http/gateway/v1/ops', g_gateway_ops],
  ['gateway', '@fathom/contracts/http/gateway/v1/practice-items', g_gateway_practice_items],
  ['gateway', '@fathom/contracts/http/gateway/v1/review', g_gateway_review],
  ['gateway', '@fathom/contracts/http/gateway/v1/session', g_gateway_session],
  ['gateway', '@fathom/contracts/http/gateway/v1/sessions', g_gateway_sessions],
  ['gateway', '@fathom/contracts/http/gateway/v1/settings', g_gateway_settings],
  ['gateway', '@fathom/contracts/http/gateway/v1/stream', g_gateway_stream],
  ['content', '@fathom/contracts/http/content/v1/acquisition', g_content_acquisition],
  ['content', '@fathom/contracts/http/content/v1/catalog', g_content_catalog],
  ['content', '@fathom/contracts/http/content/v1/errors', g_content_errors],
  ['content', '@fathom/contracts/http/content/v1/grading', g_content_grading],
  ['content', '@fathom/contracts/http/content/v1/itembank', g_content_itembank],
  ['content', '@fathom/contracts/http/content/v1/overlays', g_content_overlays],
  ['content', '@fathom/contracts/http/content/v1/runner', g_content_runner],
  ['learning', '@fathom/contracts/http/learning/v1/attempts', g_learning_attempts],
  ['learning', '@fathom/contracts/http/learning/v1/dialogs', g_learning_dialogs],
  ['learning', '@fathom/contracts/http/learning/v1/errors', g_learning_errors],
  ['learning', '@fathom/contracts/http/learning/v1/insight', g_learning_insight],
  ['learning', '@fathom/contracts/http/learning/v1/learner', g_learning_learner],
  ['learning', '@fathom/contracts/http/learning/v1/ledger', g_learning_ledger],
  ['learning', '@fathom/contracts/http/learning/v1/longtasks', g_learning_longtasks],
  ['learning', '@fathom/contracts/http/learning/v1/notes', g_learning_notes],
  ['learning', '@fathom/contracts/http/learning/v1/seasons', g_learning_seasons],
  ['learning', '@fathom/contracts/http/learning/v1/sessions', g_learning_sessions],
  ['learning', '@fathom/contracts/http/learning/v1/settings', g_learning_settings],
  ['learning', '@fathom/contracts/http/learning/v1/telemetry', g_learning_telemetry],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/calibration', g_ai_gateway_calibration],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/errors', g_ai_gateway_errors],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/firewall', g_ai_gateway_firewall],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/generate', g_ai_gateway_generate],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/jobs', g_ai_gateway_jobs],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/judge', g_ai_gateway_judge],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/mode', g_ai_gateway_mode],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/providers', g_ai_gateway_providers],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/secrets', g_ai_gateway_secrets],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/streams', g_ai_gateway_streams],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/usage', g_ai_gateway_usage],
  ['ai-gateway', '@fathom/contracts/http/ai-gateway/v1/work-orders', g_ai_gateway_work_orders],
  ['ops-api', '@fathom/contracts/http/ops/v1/autostart', g_ops_autostart],
  ['ops-api', '@fathom/contracts/http/ops/v1/backups', g_ops_backups],
  ['ops-api', '@fathom/contracts/http/ops/v1/doctor', g_ops_doctor],
  ['ops-api', '@fathom/contracts/http/ops/v1/errors', g_ops_errors],
  ['ops-api', '@fathom/contracts/http/ops/v1/health', g_ops_health],
  ['ops-api', '@fathom/contracts/http/ops/v1/logs', g_ops_logs],
  ['ops-api', '@fathom/contracts/http/ops/v1/operations', g_ops_operations],
  ['ops-api', '@fathom/contracts/http/ops/v1/system', g_ops_system],
  ['ops-api', '@fathom/contracts/http/ops/v1/telemetry', g_ops_telemetry],
  ['ops-api', '@fathom/contracts/http/ops/v1/timeline', g_ops_timeline],
  ['ops-api', '@fathom/contracts/http/ops/v1/transfer', g_ops_transfer],
  ['ops-api', '@fathom/contracts/http/ops/v1/upgrade', g_ops_upgrade],
];
const DIR_OF: Readonly<Record<StackService, string>> = {
  gateway: 'gateway',
  content: 'content',
  learning: 'learning',
  'ai-gateway': 'ai-gateway',
  'ops-api': 'ops',
};
const ALL: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const WITH_DB: readonly StackService[] = ['content', 'learning', 'ai-gateway'];
const WITH_SHUTDOWN: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway'];
/** IF-01 §3.1 IF-COM 표의 "적용 서비스" 열(`/healthz`·`/readyz`는 제외). */
const COMMON_APPLIES: Readonly<Record<string, readonly StackService[]>> = {
  'IF-COM-003': ALL,
  'IF-COM-004': ALL,
  'IF-COM-005': WITH_DB,
  'IF-COM-006': WITH_DB,
  'IF-COM-007': WITH_DB,
  'IF-COM-008': WITH_SHUTDOWN,
  'IF-COM-009': WITH_DB,
  'IF-COM-010': WITH_DB,
};
const REQUIRED_GATEWAY = ['IF-GW-001', 'IF-GW-180', 'IF-GW-181', 'IF-GW-199'];
const PROBE_BODY = '{"__acl_probe__":1}';
const CLI_TOKEN = 'C'.repeat(43);

type Verdict = 'registered' | 'pending';
type Stats = { registered: number; pending: number; positive_skipped: number };
type Reply = { status: number; code: string };

function routesOf(svc: StackService): RouteDef[] {
  const own = GROUPS.filter(([s]) => s === svc).map(([, , mod]) => mod);
  const common = Object.entries(COMMON_APPLIES)
    .filter(([, services]) => services.includes(svc))
    .map(([ifId]) => ifId);
  const commonRoutes = collectRoutes([adminRoutes, inboxRoutes]).filter((r) => common.includes(r.ifId));
  return [...collectRoutes(own), ...commonRoutes];
}

function concretePath(route: RouteDef): string {
  return route.path.replace(/\{[^}]+\}/g, fixedUlid(1));
}

function skipsPositive(route: RouteDef): boolean {
  return route.method !== 'GET' && !route.idempotent && route.request.body === undefined;
}

async function send(base: string, route: RouteDef, bearer: string | null): Promise<Reply> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (bearer !== null) {
    headers.authorization = `Bearer ${bearer}`;
  }
  const init: RequestInit = { method: route.method, headers, signal: AbortSignal.timeout(5_000) };
  if (route.method !== 'GET') {
    headers['content-type'] = 'application/json; charset=utf-8';
    init.body = PROBE_BODY;
  }
  const res = await fetch(new URL(concretePath(route), base), init);
  const type = res.headers.get('content-type') ?? '';
  if (type.startsWith('text/event-stream') || type.startsWith('application/x-ndjson')) {
    await res.body?.cancel();
    return { status: res.status, code: '' };
  }
  const text = await res.text();
  let code = '';
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string') {
      code = body.code;
    }
  } catch {
    // 본문이 JSON이 아니다(metrics 등) — code 없음
  }
  return { status: res.status, code };
}

function describeReply(r: Reply): string {
  return `${String(r.status)} ${r.code}`;
}

type Ctx = { svc: StackService; base: string; violations: string[]; stats: Stats; verdicts: Map<string, Verdict> };

function verdictOf(ctx: Ctx, route: RouteDef, r: Reply, expectedAuthCode: string): Verdict | null {
  const prefix = SVC_CODE_OF[ctx.svc];
  if (r.status === 401 && r.code === expectedAuthCode) {
    return 'registered';
  }
  if (r.status === 404 && r.code === `${prefix}-NOTFOUND-900`) {
    return 'pending';
  }
  ctx.violations.push(`${ctx.svc} ${route.ifId} ${route.method} ${route.path}: unauthenticated -> ${describeReply(r)}`);
  return null;
}

async function checkInternal(ctx: Ctx, route: RouteDef): Promise<Verdict | null> {
  const prefix = SVC_CODE_OF[ctx.svc];
  const verdict = verdictOf(ctx, route, await send(ctx.base, route, null), `${prefix}-AUTH-900`);
  if (verdict !== 'registered') {
    return verdict;
  }
  for (const caller of ALL) {
    const reply = await send(ctx.base, route, TEST_CALLER_TOKENS[caller]);
    const tag = `${ctx.svc} ${route.ifId} ${route.path} as ${caller}`;
    if (!route.allowedCallers.includes(caller)) {
      if (reply.status !== 403 || reply.code !== `${prefix}-ACL-900`) {
        ctx.violations.push(`${tag}: expected 403 ${prefix}-ACL-900, got ${describeReply(reply)}`);
      }
    } else if (skipsPositive(route)) {
      ctx.stats.positive_skipped += 1;
    } else if (reply.status === 401 || reply.status === 403) {
      ctx.violations.push(`${tag}: allowed caller rejected with ${describeReply(reply)}`);
    }
  }
  return verdict;
}

async function checkGatewayCli(ctx: Ctx, route: RouteDef): Promise<Verdict | null> {
  const verdict = verdictOf(ctx, route, await send(ctx.base, route, null), 'GW-AUTH-007');
  if (verdict !== 'registered') {
    return verdict;
  }
  const asService = await send(ctx.base, route, TEST_CALLER_TOKENS.gateway);
  if (asService.status !== 401 || asService.code !== 'GW-AUTH-007') {
    ctx.violations.push(`gateway ${route.ifId} ${route.path} with service token: ${describeReply(asService)}`);
  }
  if (skipsPositive(route)) {
    ctx.stats.positive_skipped += 1;
    return verdict;
  }
  const asCli = await send(ctx.base, route, CLI_TOKEN);
  if (asCli.status === 401 || asCli.status === 403) {
    ctx.violations.push(`gateway ${route.ifId} ${route.path} with cli token: ${describeReply(asCli)}`);
  }
  return verdict;
}

/** 브라우저 GET: 자격 증명 없음 → 401 `GW-AUTH-003`, CLI 토큰 Bearer → 403 `GW-ACL-001`(IF-01 §2.5 오류 표 — Brief의 "401"보다 IF-01이 우선). */
async function checkGatewayBrowserGet(ctx: Ctx, route: RouteDef): Promise<Verdict | null> {
  const bare = await send(ctx.base, route, null);
  if (bare.status === 404 && bare.code === 'GW-NOTFOUND-900') {
    return 'pending';
  }
  if (bare.status !== 401 || bare.code !== 'GW-AUTH-003') {
    ctx.violations.push(
      `gateway ${route.ifId} ${route.path} without cookie: expected 401 GW-AUTH-003, got ${describeReply(bare)}`,
    );
    return null;
  }
  const withCli = await send(ctx.base, route, CLI_TOKEN);
  if (withCli.status !== 403 || withCli.code !== 'GW-ACL-001') {
    ctx.violations.push(
      `gateway ${route.ifId} ${route.path} with cli token: expected 403 GW-ACL-001, got ${describeReply(withCli)}`,
    );
  }
  return 'registered';
}

async function checkService(
  svc: StackService,
  base: string,
): Promise<{ verdicts: Map<string, Verdict>; violations: string[]; stats: Stats }> {
  const ctx: Ctx = {
    svc,
    base,
    violations: [],
    stats: { registered: 0, pending: 0, positive_skipped: 0 },
    verdicts: new Map(),
  };
  for (const route of routesOf(svc)) {
    let verdict: Verdict | null = null;
    if (route.path.startsWith('/internal/v1/')) {
      verdict = await checkInternal(ctx, route);
    } else if (svc === 'gateway' && route.path.startsWith('/api/v1/cli/')) {
      verdict = await checkGatewayCli(ctx, route);
    } else if (svc === 'gateway' && route.path.startsWith('/api/v1/') && route.method === 'GET') {
      verdict = await checkGatewayBrowserGet(ctx, route);
    }
    if (verdict !== null) {
      ctx.stats[verdict] += 1;
      ctx.verdicts.set(route.ifId, verdict);
    }
  }
  return { verdicts: ctx.verdicts, violations: ctx.violations, stats: ctx.stats };
}

function requiredSet(): { svc: StackService; ifId: string }[] {
  const required: { svc: StackService; ifId: string }[] = REQUIRED_GATEWAY.map((ifId) => ({ svc: 'gateway', ifId }));
  for (const [ifId, services] of Object.entries(COMMON_APPLIES)) {
    for (const svc of services) {
      required.push({ svc, ifId });
    }
  }
  return required;
}

function listedModules(): string[] {
  const found: string[] = [];
  for (const svc of ALL) {
    const dir = path.join(APP_ROOT, 'packages', 'contracts', 'src', 'http', DIR_OF[svc], 'v1');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push(`@fathom/contracts/http/${DIR_OF[svc]}/v1/${entry.name.slice(0, -'.ts'.length)}`);
      }
    }
  }
  return found.sort();
}

function writeReport(by: Record<string, Stats>): void {
  const total = { registered: 0, pending: 0, positive_skipped: 0 };
  for (const s of Object.values(by)) {
    total.registered += s.registered;
    total.pending += s.pending;
    total.positive_skipped += s.positive_skipped;
  }
  const dir = reportDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'acl.json'), `${JSON.stringify({ ...total, by_service: by }, null, 2)}\n`);
}

describe('교차 계약: ACL 행렬', () => {
  const state: {
    home: Awaited<ReturnType<typeof createTempHome>> | null;
    pids: number[];
    stop: (() => Promise<void>) | null;
  } = {
    home: null,
    pids: [],
    stop: null,
  };

  beforeAll(async () => {
    state.home = await createTempHome('fathom-ct003-');
  });
  afterAll(async () => {
    await state.stop?.();
    for (const pid of state.pids) {
      expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
    await state.home?.cleanup();
  });

  it('CT-SYS-003 호출자 × 라우트 행렬이 allowedCallers와 일치한다(401/403/허용) [NFR-SEC-003][IF-COM-003][IF-COM-004][IF-GW-001]', async () => {
    const home = state.home?.path;
    if (home === undefined) {
      throw new Error('temp home missing');
    }
    // GROUPS = 디렉터리
    expect(GROUPS.map(([, mod]) => mod).sort()).toEqual(listedModules());
    const callers: readonly CallerName[] = ALL;
    expect(callers).toHaveLength(5);

    await migrateHome({ appRoot: APP_ROOT, home, runtime: 'src', egress: 'off' });
    const stack = await launchDirect({
      home,
      runtime: 'src',
      services: ALL,
      tokens: TEST_CALLER_TOKENS,
      cliToken: CLI_TOKEN,
      contractsHash: CONTRACTS_HASH,
    });
    state.stop = stack.stop;
    const by: Record<string, Stats> = {};
    const verdicts = new Map<string, Verdict>();
    const violations: string[] = [];
    await Promise.all(
      ALL.map(async (svc) => {
        const service = stack.services[svc];
        if (service === undefined) {
          throw new Error(`${svc} not launched`);
        }
        state.pids.push(service.pid);
        const result = await checkService(svc, service.baseUrl);
        by[svc] = result.stats;
        violations.push(...result.violations);
        for (const [ifId, verdict] of result.verdicts) {
          verdicts.set(`${svc}:${ifId}`, verdict);
        }
      }),
    );
    writeReport(by);
    const missing = requiredSet()
      .filter(({ svc, ifId }) => verdicts.get(`${svc}:${ifId}`) !== 'registered')
      .map(({ svc, ifId }) => `${svc} ${ifId} (${verdicts.get(`${svc}:${ifId}`) ?? 'not checked'})`);
    expect(violations).toEqual([]);
    expect(missing, '필수 등록 집합').toEqual([]);
  });
});
