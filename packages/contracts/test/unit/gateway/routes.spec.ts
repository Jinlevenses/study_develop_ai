import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteDef } from '../../../src/common/route.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { ConsentBody } from '../../../src/http/ai-gateway/v1/providers.js';
import { JudgeCardPostSubmit } from '../../../src/http/content/v1/post-submit/judge-card.js';
import { HintQuery, HintViewPreSubmit } from '../../../src/http/content/v1/pre-submit/hint.js';
import { SubmitAttemptBody } from '../../../src/http/learning/v1/attempts.js';
import { NoteView } from '../../../src/http/learning/v1/notes.js';
import { AttemptOutcomePostSubmit } from '../../../src/http/learning/v1/post-submit/attempt.js';
import { RunBackupBody } from '../../../src/http/ops/v1/backups.js';
import { ALL_ROUTES, GW_ALL, GW_GROUPS, LR_ALL } from './all-routes.js';
import { PASSTHROUGH } from './expected-passthrough.js';
import { EXPECTED_GW_ROUTES } from './expected-routes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '../../../src/events/__consumers__/gateway.json');
const byIf = new Map(ALL_ROUTES.map((r) => [r.ifId, r]));
const route = (ifId: string): RouteDef => {
  const r = byIf.get(ifId as RouteDef['ifId']);
  if (r === undefined) {
    throw new Error(`missing ${ifId}`);
  }
  return r;
};
const first = (o: Readonly<Record<number, unknown>>): unknown => Object.values(o)[0];

describe('gateway 라우트 179개 · 패스스루 동일성 · 소비자 매니페스트', () => {
  it('UT-CON-207 GW_*_ROUTES 19개 합집합 = §4 표 179행(IF-GW-001 정확히 1회·cli.ts)·호출자·경로 접두·멱등·데드라인·SSE·bodyLimit 규칙 [IR-015]', () => {
    expect(Object.fromEntries(Object.entries(GW_GROUPS).map(([k, g]) => [k, g.length]))).toEqual({
      session: 4,
      stream: 1,
      home: 2,
      sessions: 17,
      'practice-items': 8,
      concepts: 14,
      map: 1,
      evidence: 2,
      dialogs: 8,
      longtasks: 10,
      review: 8,
      inbox: 3,
      imports: 7,
      curation: 10,
      ai: 28,
      ops: 23,
      settings: 15,
      cli: 17,
      internal: 1,
    });
    expect(GW_ALL).toHaveLength(179);
    expect(new Set(GW_ALL.map((r) => r.ifId)).size).toBe(179);
    expect(new Set(EXPECTED_GW_ROUTES.map((r) => r[0]))).toEqual(new Set(GW_ALL.map((r) => r.ifId)));
    // IF-GW-001: §4.2·§4.9 두 표에 있으나 cli.ts에 1번만(E2)
    expect(GW_ALL.filter((r) => r.ifId === 'IF-GW-001')).toHaveLength(1);
    expect(GW_GROUPS.cli?.some((r) => r.ifId === 'IF-GW-001')).toBe(true);
    expect(GW_GROUPS.session?.some((r) => r.ifId === 'IF-GW-001')).toBe(false);
    expect(route('IF-GW-001').id).toBe('gateway.cli.bootstrap_token');
    expect(route('IF-GW-001').allowedCallers).toEqual(['cli']);

    for (const [ifId, method, path, id, idempotent, deadlineMs, paginated] of EXPECTED_GW_ROUTES) {
      const r = route(ifId);
      expect(r.method, ifId).toBe(method);
      expect(r.path, ifId).toBe(path);
      expect(r.id, ifId).toBe(id);
      expect(r.idempotent, ifId).toBe(idempotent);
      expect(r.deadlineMs ?? null, ifId).toBe(deadlineMs);
      expect(r.paginated, ifId).toBe(paginated);
      expect(r.id.startsWith('gateway.'), ifId).toBe(true);
      if (ifId === 'IF-GW-199') {
        expect(r.allowedCallers).toEqual(['ops-api']);
        expect(r.path).toBe('/internal/v1/activity');
      } else {
        expect(r.path.startsWith('/api/v1/'), ifId).toBe(true);
        expect(r.allowedCallers, ifId).toEqual(r.path.startsWith('/api/v1/cli/') ? ['cli'] : ['browser']);
      }
      expect(r.freeze === 'D', ifId).toBe(r.slice === 'R0' || r.slice === 'R1');
      expect(Object.keys(r.response), ifId).toHaveLength(1);
      const names = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const params = r.request.params as { shape?: Record<string, unknown> } | undefined;
      expect(Object.keys(params?.shape ?? {}), ifId).toEqual(names);
    }
    expect(GW_ALL.filter((r) => r.path.startsWith('/api/v1/cli/')).every((r) => r.allowedCallers[0] === 'cli')).toBe(
      true,
    );
    expect(GW_ALL.filter((r) => r.allowedCallers[0] === 'cli')).toHaveLength(17);
    // 데드라인 13개(§4.3)
    expect(GW_ALL.filter((r) => r.deadlineMs !== undefined).map((r) => [r.ifId, r.deadlineMs])).toEqual([
      ['IF-GW-010', 1500],
      ['IF-GW-015', 2000],
      ['IF-GW-020', 2900],
      ['IF-GW-021', 2900],
      ['IF-GW-038', 6000],
      ['IF-GW-050', 1000],
      ['IF-GW-055', 1500],
      ['IF-GW-062', 3500],
      ['IF-GW-063', 60000],
      ['IF-GW-067', 60000],
      ['IF-GW-084', 2900],
      ['IF-GW-103', 2900],
      ['IF-GW-163', 60000],
    ]);
    // SSE(005·063·067) = 바이트 중계 z.string(), 본문 한도 4 MiB = 086·088·188
    expect(GW_ALL.filter((r) => r.responseKind === 'sse').map((r) => r.ifId)).toEqual([
      'IF-GW-005',
      'IF-GW-063',
      'IF-GW-067',
    ]);
    for (const ifId of ['IF-GW-005', 'IF-GW-063', 'IF-GW-067']) {
      const schema = route(ifId).response[200];
      expect(schema?.safeParse('id: 1\nevent: meta\n\n').success, ifId).toBe(true);
      expect(schema?.safeParse(1).success, ifId).toBe(false);
    }
    expect(GW_ALL.filter((r) => r.responseKind === 'ndjson' || r.request.bodyKind === 'ndjson')).toHaveLength(0);
    expect(GW_ALL.filter((r) => r.bodyLimitBytes !== undefined).map((r) => [r.ifId, r.bodyLimitBytes])).toEqual([
      ['IF-GW-086', 4_194_304],
      ['IF-GW-088', 4_194_304],
      ['IF-GW-188', 4_194_304],
    ]);
    // 204(본문 없음): 로그아웃·generic-cli 삭제·비밀 삭제·배너 해제
    const noBody = ['IF-GW-004', 'IF-GW-110', 'IF-GW-113', 'IF-GW-136'];
    for (const ifId of noBody) {
      expect(Object.keys(route(ifId).response), ifId).toEqual(['204']);
      expect(route(ifId).response[204]?.safeParse(null).success, ifId).toBe(true);
      expect(route(ifId).response[204]?.safeParse({}).success, ifId).toBe(false);
    }
    // 집계(⊕) 응답 = gateway 블록 뷰 7종
    expect(
      ['IF-GW-010', 'IF-GW-040', 'IF-GW-041', 'IF-GW-043', 'IF-GW-055', 'IF-GW-105', 'IF-GW-180'].map(
        (i) => Object.keys(route(i).response)[0],
      ),
    ).toEqual(['200', '200', '200', '200', '200', '200', '200']);
    // IF-GW-190 = 슬라이스 R1·D(첫 R\d·D)
    expect([route('IF-GW-190').slice, route('IF-GW-190').freeze]).toEqual(['R1', 'D']);
    // 멱등 POST인 조회형(items:select 계열)은 없고 firewall:preview는 비멱등
    expect(route('IF-GW-132').idempotent).toBe(false);
  });

  it('UT-CON-208 패스스루 동일성(Object.is): GW-065 NoteView·GW-020·GW-032·GW-035·GW-107·GW-139 + 하위 = IF-… 전 행 [STD-API-04]', () => {
    expect(route('IF-GW-065').response[200]).toBe(NoteView);
    expect(route('IF-GW-065').response[200]).toBe(route('IF-LR-024').response[200]); // TST C2
    expect(route('IF-GW-020').request.body).toBe(SubmitAttemptBody);
    expect(route('IF-GW-020').response[200]).toBe(AttemptOutcomePostSubmit);
    expect(route('IF-GW-032').request.query).toBe(HintQuery);
    expect(route('IF-GW-032').response[200]).toBe(HintViewPreSubmit);
    expect(route('IF-GW-035').response[200]).toBe(JudgeCardPostSubmit);
    expect(route('IF-GW-107').request.body).toBe(ConsentBody);
    expect(route('IF-GW-139').request.body).toBe(RunBackupBody);

    // 경로→본문 병합·공개 본문 예외(표의 공개 스키마) — 하위와 다른 이름을 쓰는 행
    const PUBLIC_BODY = new Set(['IF-GW-033', 'IF-GW-036', 'IF-GW-038', 'IF-GW-181']);
    let compared = 0;
    let identical = 0;
    // 응답이 Page<X>인지(= `items`·`next_cursor` 속성) — Page(X)는 호출마다 새 객체를 만든다.
    const isPage = (schema: unknown): boolean => {
      const props = (z.toJSONSchema(schema as z.ZodType) as { properties?: Record<string, unknown> }).properties ?? {};
      return 'items' in props && 'next_cursor' in props;
    };
    for (const [gw, down] of PASSTHROUGH) {
      const g = route(gw);
      const d = route(down);
      if (g.request.query !== undefined || d.request.query !== undefined) {
        expect(g.request.query, `${gw} ← ${down} query`).toBe(d.request.query);
        compared++;
      }
      if (!PUBLIC_BODY.has(gw) && (g.request.body !== undefined || d.request.body !== undefined)) {
        expect(g.request.body, `${gw} ← ${down} body`).toBe(d.request.body);
        compared++;
      }
      const gr = first(g.response);
      const dr = first(d.response);
      if (g.responseKind === 'sse') {
        // SSE = 바이트 중계 z.string()(무검증) — 같은 종류(sse)인지만 본다.
        expect(d.responseKind, `${gw} ← ${down} responseKind`).toBe('sse');
      } else if (g.response[204] !== undefined) {
        // 204 = 본문 없음(z.null()) — 하위도 204인지만 본다.
        expect(Object.keys(d.response), `${gw} ← ${down} status`).toEqual(['204']);
      } else if (isPage(gr)) {
        // Page(X)는 호출마다 새 객체를 만드는 헬퍼라 동일성 대신 JSON Schema 동치로 단언한다.
        expect(z.toJSONSchema(gr as z.ZodType), `${gw} ← ${down} Page response`).toEqual(
          z.toJSONSchema(dr as z.ZodType),
        );
      } else {
        expect(gr, `${gw} ← ${down} response`).toBe(dr);
        identical++;
      }
      compared++;
    }
    expect(PASSTHROUGH).toHaveLength(161);
    expect(compared).toBeGreaterThan(250);
    expect(identical).toBeGreaterThan(100);
    // 예외 4건: 경로의 id가 본문으로 병합되는 공개 본문(CreateReportBody·AppealBody)·공개 러너 본문(CreateRunBody)·CLI 공개 본문(CliShutdownBody)
    expect(route('IF-GW-033').request.body).not.toBe(route('IF-CT-057').request.body);
    expect(route('IF-GW-036').request.body).not.toBe(route('IF-LR-018').request.body);
    expect(route('IF-GW-038').request.body).not.toBe(route('IF-CT-050').request.body);
    expect(route('IF-GW-181').request.body).not.toBe(route('IF-OP-050').request.body);
  });

  it('UT-CON-211 gateway.json 통과·구독 17개(전부 notify·drop·["*"])·17 type = §9.5 gateway 행 [NFR-MAINT-003]', async () => {
    const text = await readFile(MANIFEST, 'utf8');
    const parsed = ConsumerManifest.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.consumer).toBe('gateway');
    expect(parsed.data.subscriptions).toHaveLength(17);
    expect(parsed.data.subscriptions.map((s) => s.type)).toEqual([
      'catalog.pack.activated',
      'catalog.overlay.conflicted',
      'acquisition.import.staged',
      'grading.verdict.revised',
      'itembank.item.corrected',
      'learning.session.completed',
      'learning.mastery.changed',
      'learning.level.promoted',
      'learning.ledger.merged',
      'ai.mode.changed',
      'ai.provider.status_changed',
      'ai.work_order.approval_requested',
      'ai.work_order.decided',
      'ai.budget.threshold_reached',
      'ai.judge.drift_detected',
      'ops.health.changed',
      'ops.backup.completed',
    ]);
    for (const s of parsed.data.subscriptions) {
      expect(s.mode, s.type).toBe('notify');
      expect(s.on_poison, s.type).toBe('drop');
      expect(s.reads, s.type).toEqual(['*']);
      expect(s.schema_versions, s.type).toEqual([1]);
      expect(Object.keys(s), s.type).toEqual(['type', 'schema_versions', 'mode', 'on_poison', 'reads']);
    }
    expect(new Set(parsed.data.subscriptions.map((s) => s.type)).size).toBe(17);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text.startsWith('{\n  "consumer": "gateway",\n  "subscriptions": [\n')).toBe(true);
    // 학습(LR) 라우트 수 대조 — 이 파일이 gateway 전체와 learning을 함께 묶는 교차 점검
    expect(LR_ALL).toHaveLength(75);
  });
});
