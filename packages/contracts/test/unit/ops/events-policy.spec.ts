import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AI_EVENTS } from '../../../src/events/catalog/ai.js';
import {
  OPS_EVENTS,
  OpsBackupCompletedV1,
  OpsHealthChangedV1,
  OpsHostStateChangedV1,
} from '../../../src/events/catalog/ops.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { EventType } from '../../../src/events/envelope.js';
import { OpsPolicyV1 } from '../../../src/policy/ops_policy.js';
import { banner, ULID, ULID_B } from './samples.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSUMERS_DIR = resolve(HERE, '../../../src/events/__consumers__');

const health = {
  services: [{ svc: 'supervisor', state: 'ready', restarts_60s: 0 }],
  degraded: [],
  outbox_lag: [{ svc: 'content', dest: 'learning', oldest_age_ms: 10 }],
  banners: [banner],
};
const backup = { epoch_id: ULID, kind: 'snapshot', outcome: 'ok', reason: null, rpo_hours: 1.5 };
const host = { idle_window_open: true, idle_since: 1, power: 'ac', interactive_cli: ['claude-cli'], sampled_at: 2 };

describe('ops 이벤트 payload (events/catalog/ops.ts)', () => {
  it('UT-CON-168 events/catalog/ops.ts 3종 + OPS_EVENTS(IF-EV-21~23, producer ops-api) [FR-SET-001][FR-SET-004]', () => {
    expect(OpsHealthChangedV1.safeParse(health).success).toBe(true);
    expect(
      OpsHealthChangedV1.safeParse({ ...health, services: [{ svc: 'cli', state: 'ready', restarts_60s: 0 }] }).success,
    ).toBe(false);
    expect(OpsHealthChangedV1.safeParse({ ...health, services: Array(9).fill(health.services[0]) }).success).toBe(
      false,
    );
    expect(OpsHealthChangedV1.safeParse({ ...health, extra: 1 }).success).toBe(false);
    expect(OpsBackupCompletedV1.safeParse(backup).success).toBe(true);
    expect(
      OpsBackupCompletedV1.safeParse({ ...backup, kind: 'rehearsal', outcome: 'failed', rpo_hours: null }).success,
    ).toBe(true);
    expect(OpsBackupCompletedV1.safeParse({ ...backup, outcome: 'pending' }).success).toBe(false);
    expect(OpsBackupCompletedV1.safeParse({ ...backup, rpo_hours: -1 }).success).toBe(false);
    expect(OpsHostStateChangedV1.safeParse(host).success).toBe(true);
    expect(OpsHostStateChangedV1.safeParse({ ...host, power: 'solar' }).success).toBe(false);
    expect(OpsHostStateChangedV1.safeParse({ ...host, interactive_cli: ['jev'] }).success).toBe(true);
    expect(OpsHostStateChangedV1.safeParse({ ...host, interactive_cli: Array(9).fill('jev') }).success).toBe(false);
    expect(OpsHostStateChangedV1.safeParse({ ...host, idle_since: null }).success).toBe(true);

    // IF-01 §9.3 표(IF-ID · type · 동결·슬라이스)
    const table: Record<string, [string, 'D' | 'O', string]> = {
      'IF-EV-21': ['ops.health.changed', 'D', 'R0'],
      'IF-EV-22': ['ops.backup.completed', 'D', 'R1'],
      'IF-EV-23': ['ops.host_state.changed', 'D', 'R1'],
    };
    expect(Object.keys(OPS_EVENTS)).toEqual(Object.values(table).map((r) => r[0]));
    for (const [type, e] of Object.entries(OPS_EVENTS)) {
      const row = table[e.ifId];
      expect(row?.[0], e.ifId).toBe(type);
      expect(EventType.safeParse(type).success, type).toBe(true);
      expect(e.producer, type).toBe('ops-api');
      expect(e.freeze, type).toBe(row?.[1]);
      expect(e.slice, type).toBe(row?.[2]);
      expect(Object.keys(e.versions), type).toEqual(['1']);
    }
    expect(OPS_EVENTS['ops.health.changed'].versions[1]).toBe(OpsHealthChangedV1);
    expect(OPS_EVENTS['ops.backup.completed'].versions[1]).toBe(OpsBackupCompletedV1);
    expect(OPS_EVENTS['ops.host_state.changed'].versions[1]).toBe(OpsHostStateChangedV1);
    expect(ULID_B).toHaveLength(26);
  });

  it('UT-CON-169 ops-api.json 통과·구독 7개·형식, ai.* 구독 reads ⊆ 생산자 키 [NFR-MAINT-003][AQ-02]', async () => {
    const text = await readFile(resolve(CONSUMERS_DIR, 'ops-api.json'), 'utf8');
    const manifest = ConsumerManifest.parse(JSON.parse(text));
    expect(manifest.consumer).toBe('ops-api');
    expect(manifest.subscriptions).toHaveLength(7);
    expect(manifest.subscriptions.map((s) => [s.type, s.mode, s.on_poison])).toEqual([
      ['learning.session.completed', 'durable', 'dead_letter'],
      ['learning.level.promoted', 'durable', 'dead_letter'],
      ['learning.ledger.merged', 'durable', 'dead_letter'],
      ['ai.mode.changed', 'durable', 'dead_letter'],
      ['ai.provider.status_changed', 'durable', 'dead_letter'],
      ['ai.budget.threshold_reached', 'durable', 'dead_letter'],
      ['ai.judge.drift_detected', 'durable', 'dead_letter'],
    ]);
    for (const s of manifest.subscriptions) {
      expect(s.schema_versions).toEqual([1]);
    }
    expect(manifest.subscriptions[0]?.reads).toEqual([
      'session_id',
      'duration_ms',
      'first_item_latency_ms',
      'completed_at',
    ]);
    expect(manifest.subscriptions[3]?.reads).toEqual(['mode', 'previous_mode', 'reasons', 'changed_at']);
    // 형식: 2칸 들여쓰기·끝 줄바꿈 1개
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\t');
    for (const line of text.split('\n')) {
      expect((line.length - line.trimStart().length) % 2, line).toBe(0);
    }
    expect(text.startsWith('{\n  "consumer": "ops-api",\n  "subscriptions": [\n')).toBe(true);
    // ai.* reads ⊆ 생산자(AI_EVENTS) 스키마 최상위 키. learning.* 은 T-00-10 몫.
    const aiSubs = manifest.subscriptions.filter((s) => s.type.startsWith('ai.'));
    expect(aiSubs).toHaveLength(4);
    for (const s of aiSubs) {
      const entry = (AI_EVENTS as Record<string, { versions: Record<number, { shape?: object }> }>)[s.type];
      expect(entry, s.type).toBeDefined();
      const keys = Object.keys(entry?.versions[1]?.shape ?? {});
      for (const r of s.reads) {
        expect(keys, `${s.type}.${r}`).toContain(r);
      }
    }
  });
});

// ARC-01 §10.4 `ops_policy@v1` 초기값: 증분 일 1·스냅샷 주 1·7세대, quiesce 2s·snapshot 30s, 로그 14일·50MB, Tripwire 유휴 RSS 400MB·콜드 10s, 디스크 경고 500MB.
const opsPolicy = () => ({
  version: 'ops_policy@v1',
  backup: { incremental_per_day: 1, snapshot_per_week: 1, generations: 7, quiesce_ms: 2000, snapshot_ms: 30000 },
  logs: { days: 14, max_mb_per_svc: 50 },
  tripwire: { idle_rss_mb: 400, cold_start_ms: 10000 },
  disk_warn_mb: 500,
});

describe('policy/ops_policy.ts', () => {
  it('UT-CON-170 OpsPolicyV1: ARC §10.4 값 통과, generations 0 거부, 미지 키 거부 [NFR-MAINT-007]', () => {
    const base = opsPolicy();
    expect(OpsPolicyV1.safeParse(base).success).toBe(true);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, generations: 0 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, generations: 1 } }).success).toBe(true);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, incremental_per_day: 0 } }).success).toBe(true);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, incremental_per_day: -1 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, snapshot_ms: 0 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, quiesce_ms: 0 } }).success).toBe(true);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, snapshot_per_week: 1.5 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, logs: { days: 0, max_mb_per_svc: 50 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, logs: { days: 14, max_mb_per_svc: 0 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, tripwire: { idle_rss_mb: 0, cold_start_ms: 10000 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, tripwire: { idle_rss_mb: 400, cold_start_ms: 0 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, disk_warn_mb: -1 }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, disk_warn_mb: 0 }).success).toBe(true);
    // 미지 키 거부(최상위·중첩)
    expect(OpsPolicyV1.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, backup: { ...base.backup, extra: 1 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, logs: { ...base.logs, retention: 3 } }).success).toBe(false);
    expect(OpsPolicyV1.safeParse({ ...base, version: 'ops_policy@v2' }).success).toBe(false);
    const { disk_warn_mb: _d, ...partial } = base;
    expect(OpsPolicyV1.safeParse(partial).success).toBe(false);
  });
});
