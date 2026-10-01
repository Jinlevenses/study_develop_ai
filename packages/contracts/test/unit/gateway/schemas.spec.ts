import { describe, expect, it } from 'vitest';
import { AiStatusView } from '../../../src/http/gateway/v1/ai.js';
import {
  CliAutostartBody,
  CliPackBody,
  CliShutdownBody,
  CliStatus,
  CliUpgradeBody,
  SessionKeyRotated,
} from '../../../src/http/gateway/v1/cli.js';
import { ConceptPageView, TrackListView, TrackView, TrackViewQuery } from '../../../src/http/gateway/v1/concepts.js';
import { GW_ERRORS } from '../../../src/http/gateway/v1/errors.js';
import { HomeView } from '../../../src/http/gateway/v1/home.js';
import { ActivityView } from '../../../src/http/gateway/v1/internal.js';
import { DepthMapView } from '../../../src/http/gateway/v1/map.js';
import {
  Base64Url32,
  BootstrapTokenRequest,
  BootstrapTokenResponse,
  CsrfResponse,
  ExchangeRequest,
  ExchangeResponse,
  SessionStatus,
} from '../../../src/http/gateway/v1/session.js';
import { SseEventData, SseHello, SseResync } from '../../../src/http/gateway/v1/stream.js';
import {
  alert,
  B64,
  banner,
  conceptContent,
  healthBoard,
  home,
  learnerState,
  mapCell,
  modeView,
  NOW,
  providerView,
  ULID,
  ULID_B,
  withFields,
} from './samples.js';

describe('gateway 세션·스트림·뷰 스키마', () => {
  it('UT-CON-205 session.ts(Base64Url32 43자만)·stream.ts(SseHello·SseResync.reason 3·SseEventData) [NFR-SEC-019][IR-016]', () => {
    expect(Base64Url32.safeParse(B64).success).toBe(true);
    expect(Base64Url32.safeParse(`${'Az09_-'.repeat(7)}A`).success).toBe(true); // 6 × 7 + 1 = 43자, 영문·숫자·`-`·`_`
    expect(Base64Url32.safeParse('A'.repeat(42)).success).toBe(false);
    expect(Base64Url32.safeParse('A'.repeat(44)).success).toBe(false);
    expect(Base64Url32.safeParse(`${'A'.repeat(42)}=`).success).toBe(false); // 패딩 없음
    expect(Base64Url32.safeParse(`${'A'.repeat(42)}+`).success).toBe(false);
    expect(Base64Url32.safeParse(`${'A'.repeat(42)}/`).success).toBe(false);
    expect(Base64Url32.safeParse(`${'A'.repeat(41)}-_`).success).toBe(true);

    expect(BootstrapTokenRequest.safeParse({ purpose: 'up' }).success).toBe(true);
    expect(BootstrapTokenRequest.safeParse({ purpose: 'open' }).success).toBe(true);
    expect(BootstrapTokenRequest.safeParse({ purpose: 'down' }).success).toBe(false);
    const token = { bootstrap_token: B64, expires_at: NOW, open_url: `http://127.0.0.1:4747/#bt=${B64}` };
    expect(BootstrapTokenResponse.safeParse(token).success).toBe(true);
    expect(BootstrapTokenResponse.safeParse({ ...token, open_url: 'not a url' }).success).toBe(false);
    expect(BootstrapTokenResponse.safeParse({ ...token, extra: 1 }).success).toBe(false);
    expect(ExchangeRequest.safeParse({ bt: B64 }).success).toBe(true);
    expect(ExchangeRequest.safeParse({ bt: 'short' }).success).toBe(false);
    const exchanged = { session_established: true, port: 4747, app_version: '1.0.0', profile: 'prod' };
    expect(ExchangeResponse.safeParse(exchanged).success).toBe(true);
    expect(ExchangeResponse.safeParse({ ...exchanged, session_established: false }).success).toBe(false);
    expect(ExchangeResponse.safeParse({ ...exchanged, port: 65536 }).success).toBe(false);
    expect(ExchangeResponse.safeParse({ ...exchanged, port: 0 }).success).toBe(false);
    expect(ExchangeResponse.safeParse({ ...exchanged, profile: 'staging' }).success).toBe(false);
    expect(CsrfResponse.safeParse({ csrf: B64 }).success).toBe(true);
    expect(CsrfResponse.safeParse({ csrf: B64, extra: 1 }).success).toBe(false);
    const status = {
      authenticated: true,
      port: 4747,
      app_version: '1.0.0',
      boot_id: ULID,
      profile: 'dev',
      safe_mode: false,
      maintenance: 'none',
    };
    expect(SessionStatus.safeParse(status).success).toBe(true);
    expect(SessionStatus.safeParse({ ...status, maintenance: 'restore' }).success).toBe(true);
    expect(SessionStatus.safeParse({ ...status, maintenance: 'backup' }).success).toBe(false);
    expect(SessionStatus.safeParse({ ...status, authenticated: false }).success).toBe(false);

    const hello = { boot_id: ULID, hub_seq: 0, server_time: NOW, app_version: '1.0.0', ai_mode: 'OFFLINE' };
    expect(SseHello.safeParse(hello).success).toBe(true);
    expect(SseHello.safeParse({ ...hello, hub_seq: -1 }).success).toBe(false);
    expect(SseHello.safeParse({ ...hello, ai_mode: 'ONLINE' }).success).toBe(false);
    expect(SseHello.safeParse({ ...hello, extra: 1 }).success).toBe(false);
    expect(SseResync.shape.reason.options).toEqual(['gateway_restarted', 'ring_overflow', 'unknown_last_event_id']);
    for (const reason of SseResync.shape.reason.options) {
      expect(SseResync.safeParse({ reason }).success, reason).toBe(true);
    }
    expect(SseResync.safeParse({ reason: 'timeout' }).success).toBe(false);
    const event = {
      type: 'learning.session.completed',
      schema_version: 1,
      event_id: ULID,
      occurred_at: NOW,
      correlation_id: ULID_B,
      producer: 'learning',
      payload: { session_id: ULID },
    };
    expect(SseEventData.safeParse(event).success).toBe(true);
    expect(SseEventData.safeParse({ ...event, type: 'Learning.Session' }).success).toBe(false);
    expect(SseEventData.safeParse({ ...event, schema_version: 0 }).success).toBe(false);
    expect(SseEventData.safeParse({ ...event, producer: 'browser' }).success).toBe(false);
    expect(SseEventData.safeParse({ ...event, payload: [] }).success).toBe(false);
    expect(SseEventData.safeParse({ ...event, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-206 HomeView alerts 4·banners 6 거부·TrackView.levels 5만·ConceptPageView.entry_stage 4·DepthMapView·AiStatusView·CliPackBody 4·CliUpgradeBody 2·CliStatus·ActivityView [FR-DSH-001][FR-SET-015]', () => {
    expect(HomeView.safeParse(home).success).toBe(true);
    expect(HomeView.safeParse(withFields(home, { alerts: [alert, alert, alert] })).success).toBe(true);
    expect(HomeView.safeParse(withFields(home, { alerts: [alert, alert, alert, alert] })).success).toBe(false);
    expect(HomeView.safeParse(withFields(home, { banners: Array.from({ length: 5 }, () => banner) })).success).toBe(
      true,
    );
    expect(HomeView.safeParse(withFields(home, { banners: Array.from({ length: 6 }, () => banner) })).success).toBe(
      false,
    );
    expect(
      HomeView.safeParse(withFields(home, { ai_chip: { mode: 'FULL', label_ko: 'AI: 켜짐', degraded_badge: false } }))
        .success,
    ).toBe(false);
    expect(
      HomeView.safeParse(
        withFields(home, { degraded: [{ part: 'home.ai_chip', dependency: 'ai-gateway', code: 'AI-DEP-001' }] }),
      ).success,
    ).toBe(true);
    expect(
      HomeView.safeParse(
        withFields(home, { degraded: [{ part: 'Home', dependency: 'ai-gateway', code: 'AI-DEP-001' }] }),
      ).success,
    ).toBe(false);
    expect(HomeView.safeParse({ ...home, extra: 1 }).success).toBe(false);

    const level = (n: number) => ({ level: n, concepts: [] });
    const track = {
      track: 'k8s',
      title_ko: '쿠버네티스',
      cap: { declared: 3, offline: 3, oracle: 3, display: 3 },
      levels: [1, 2, 3, 4, 5].map(level),
      learner: null,
      degraded: [],
    };
    expect(TrackView.safeParse(track).success).toBe(true);
    expect(TrackView.safeParse(withFields(track, { levels: [1, 2, 3, 4].map(level) })).success).toBe(false);
    expect(TrackView.safeParse(withFields(track, { levels: [1, 2, 3, 4, 5, 5].map(level) })).success).toBe(false);
    expect(TrackView.safeParse({ ...track, extra: 1 }).success).toBe(false);
    const list = {
      tracks: [
        {
          track: 'k8s',
          title_ko: '쿠버네티스',
          title_en: 'Kubernetes',
          concept_counts: [1, 2, 3, 4, 5],
          cap: track.cap,
          learner: { level: 2, provisional: false, needs_reconfirmation: false, mastered: 0 },
        },
      ],
      degraded: [],
    };
    expect(TrackListView.safeParse(list).success).toBe(true);
    expect(
      TrackListView.safeParse({ ...list, tracks: [{ ...list.tracks[0], concept_counts: [1, 2, 3, 4] }] }).success,
    ).toBe(false);
    expect(TrackViewQuery.parse({})).toEqual({});
    expect(TrackViewQuery.parse({ level: '3' })).toEqual({ level: 3 });
    expect(TrackViewQuery.safeParse({ level: '6' }).success).toBe(false);
    expect(TrackViewQuery.safeParse({ level: '0' }).success).toBe(false);

    const page = { content: conceptContent, learner: learnerState, entry_stage: 'pretest', degraded: [] };
    expect(ConceptPageView.safeParse(page).success).toBe(true);
    expect(ConceptPageView.safeParse(withFields(page, { learner: null, entry_stage: 'theory' })).success).toBe(true);
    expect(ConceptPageView.shape.entry_stage.options).toEqual(['theory', 'pretest', 'problem', 'problem_definition']);
    expect(ConceptPageView.safeParse(withFields(page, { entry_stage: 'code' })).success).toBe(false);
    expect(ConceptPageView.safeParse({ ...page, extra: 1 }).success).toBe(false);

    const map = {
      track: 'all',
      as_of: null,
      layers: ['mastery', 'retention'],
      layout: { version: 'a'.repeat(64), width: 100, height: 100 },
      cells: [mapCell],
      edges: [{ from: 'k8s.probes', to: 'k8s.pods' }],
      degraded: [],
    };
    expect(DepthMapView.safeParse(map).success).toBe(true);
    expect(DepthMapView.safeParse(withFields(map, { track: 'k8s' })).success).toBe(true);
    expect(DepthMapView.safeParse(withFields(map, { track: 'nope' })).success).toBe(false);
    expect(DepthMapView.safeParse(withFields(map, { layers: ['video'] })).success).toBe(false);
    expect(DepthMapView.safeParse(withFields(map, { cells: [{ ...mapCell, depth_ring: 5 }] })).success).toBe(false);
    expect(DepthMapView.safeParse(withFields(map, { cells: [{ ...mapCell, retention: 1.5 }] })).success).toBe(false);
    expect(
      DepthMapView.safeParse(withFields(map, { cells: Array.from({ length: 2001 }, () => mapCell) })).success,
    ).toBe(false);
    expect(DepthMapView.safeParse({ ...map, extra: 1 }).success).toBe(false);

    const ai = { mode: modeView, providers: [providerView], degraded: [] };
    expect(AiStatusView.safeParse(ai).success).toBe(true);
    expect(AiStatusView.safeParse(withFields(ai, { providers: [{ ...providerView, status: 'broken' }] })).success).toBe(
      false,
    );
    expect(AiStatusView.safeParse({ ...ai, extra: 1 }).success).toBe(false);

    const packs = [
      { action: 'install', install_id: ULID, source: { kind: 'bundled', track: 'k8s' } },
      { action: 'upgrade', install_id: ULID, source: { kind: 'bundled', track: 'k8s' } },
      { action: 'add', install_id: ULID, dir: './my-pack' },
      { action: 'refresh', install_id: ULID, track: 'k8s', work_order_id: null },
    ];
    expect(CliPackBody.options).toHaveLength(4);
    expect(CliPackBody.safeParse(packs[2]).success).toBe(true);
    expect(CliPackBody.safeParse(packs[3]).success).toBe(true);
    expect(CliPackBody.safeParse({ ...packs[2], dir: '' }).success).toBe(false);
    expect(CliPackBody.safeParse({ ...packs[3], track: 'nope' }).success).toBe(false);
    expect(CliPackBody.safeParse({ action: 'remove', install_id: ULID }).success).toBe(false);
    expect(CliPackBody.safeParse({ ...packs[2], extra: 1 }).success).toBe(false);
    const upgrades = [
      { action: 'upgrade', op_id: ULID, bundle_path: '/tmp/fathom-1.1.0.tgz' },
      { action: 'rollback', op_id: ULID },
    ];
    expect(CliUpgradeBody.options).toHaveLength(2);
    for (const u of upgrades) {
      expect(CliUpgradeBody.safeParse(u).success, u.action).toBe(true);
      expect(CliUpgradeBody.safeParse({ ...u, extra: 1 }).success, `${u.action} extra`).toBe(false);
    }
    expect(CliUpgradeBody.safeParse({ action: 'upgrade', op_id: ULID, bundle_path: '' }).success).toBe(false);
    expect(CliUpgradeBody.safeParse({ action: 'rollback', op_id: ULID, bundle_path: '/x' }).success).toBe(false);
    expect(CliAutostartBody.safeParse({ action: 'status' }).success).toBe(true);
    expect(CliAutostartBody.safeParse({ action: 'toggle' }).success).toBe(false);
    expect(CliShutdownBody.safeParse({ op_id: ULID, grace_ms: 10_000 }).success).toBe(true);
    expect(CliShutdownBody.safeParse({ op_id: ULID, grace_ms: 10_001 }).success).toBe(false);
    expect(SessionKeyRotated.safeParse({ rotated_at: NOW, sessions_invalidated: true }).success).toBe(true);
    expect(SessionKeyRotated.safeParse({ rotated_at: NOW, sessions_invalidated: false }).success).toBe(false);
    const cli = { app_version: '1.0.0', profile: 'prod', url: 'http://127.0.0.1:4747', health: healthBoard };
    expect(CliStatus.safeParse(cli).success).toBe(true);
    expect(CliStatus.safeParse({ ...cli, url: 'x' }).success).toBe(false);
    expect(CliStatus.safeParse({ ...cli, health: { ...healthBoard, overall: 'broken' } }).success).toBe(false);
    expect(CliStatus.safeParse({ ...cli, extra: 1 }).success).toBe(false);

    const activity = { last_user_activity_at: null, idle_ms: 0, active_streams: 0 };
    expect(ActivityView.safeParse(activity).success).toBe(true);
    expect(ActivityView.safeParse({ ...activity, last_user_activity_at: NOW, idle_ms: 5 }).success).toBe(true);
    expect(ActivityView.safeParse({ ...activity, active_streams: -1 }).success).toBe(false);
    expect(ActivityView.safeParse({ ...activity, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-209 GW_ERRORS 14키 = §2.6.3 GW 행·GW-AUTH-005 421·GW-LIMIT-002 retryable [STD-ERR-01]', async () => {
    const { EXPECTED_GW_CODES } = await import('./expected-errors.js');
    expect(Object.keys(GW_ERRORS)).toEqual(EXPECTED_GW_CODES);
    expect(EXPECTED_GW_CODES).toHaveLength(14);
    expect(GW_ERRORS['GW-AUTH-005'].status).toBe(421);
    expect(GW_ERRORS['GW-AUTH-001'].status).toBe(401);
    expect(GW_ERRORS['GW-AUTH-002'].status).toBe(403);
    expect(GW_ERRORS['GW-LIMIT-002'].retryable).toBe(true);
    expect(GW_ERRORS['GW-LIMIT-001'].retryable).toBe(true);
    expect(GW_ERRORS['GW-DEP-001'].status).toBe(503);
    expect(GW_ERRORS['GW-CONFLICT-010'].status).toBe(409);
    expect(GW_ERRORS['GW-CONFLICT-010'].retryable).toBe(false);
    for (const [code, e] of Object.entries(GW_ERRORS)) {
      expect(code.startsWith('GW-'), code).toBe(true);
      expect(e.title.length, code).toBeGreaterThan(0);
      expect(e.title.includes('`'), code).toBe(false);
      expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
    }
    expect(
      Object.entries(GW_ERRORS)
        .filter(([, e]) => e.retryable)
        .map(([c]) => c),
    ).toEqual(['GW-LIMIT-001', 'GW-LIMIT-002', 'GW-DEP-001', 'GW-DEP-002', 'GW-DEP-003']);
  });
});
