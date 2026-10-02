import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidationsFor, SSE_EVENT_TYPES } from '../../../src/lib/invalidation-map.js';
import { qk } from '../../../src/lib/query-keys.js';
import { EVENT_FIXTURES } from './support/events.js';
import { ULID_A, ULID_B, ULID_C } from './support/fixtures.js';

const EXPECTED: Record<string, readonly (readonly unknown[])[] | 'all'> = {
  'catalog.pack.activated': [['tracks'], ['track', 'k8s'], ['concept'], ['map']],
  'catalog.overlay.conflicted': [
    ['curation', 'conflicts'],
    ['concept', 'docker.dockerfile'],
  ],
  'acquisition.import.staged': [['imports'], ['import', ULID_A]],
  'grading.verdict.revised': [
    ['verdict', ULID_A],
    ['verdict', ULID_B],
    ['session', ULID_C],
    ['evidence', 'docker.dockerfile'],
  ],
  'itembank.item.corrected': [['session'], ['evidence'], ['curation', 'reports']],
  'learning.session.completed': [['home'], ['review', 'weekly']],
  'learning.mastery.changed': [['concept', 'k8s.probes'], ['map'], ['evidence', 'k8s.probes'], ['tracks']],
  'learning.level.promoted': [['tracks'], ['track', 'docker'], ['promotion', 'docker'], ['home']],
  'learning.ledger.merged': 'all',
  'ai.mode.changed': [['ai', 'status'], ['home']],
  'ai.provider.status_changed': [['ai', 'status']],
  'ai.work_order.approval_requested': [['ai', 'work-orders']],
  'ai.work_order.decided': [['ai', 'work-orders'], ['imports']],
  'ai.budget.threshold_reached': [
    ['ai', 'usage'],
    ['ops', 'health'],
  ],
  'ai.judge.drift_detected': [['ai', 'calibration']],
  'ops.health.changed': [['ops', 'health'], ['home']],
  'ops.backup.completed': [
    ['ops', 'backups'],
    ['ops', 'health'],
  ],
};

describe('invalidation-map', () => {
  it('UT-WEB-005 SSE_EVENT_TYPES 17종이 IF §9.6 표와 같고 각 대표 payload의 키 집합이 표와 deep equal이며 ledger.merged·resync는 전체 무효화다 [IR-016]', () => {
    expect(SSE_EVENT_TYPES).toHaveLength(17);
    expect([...SSE_EVENT_TYPES]).toEqual(Object.keys(EXPECTED));
    for (const type of SSE_EVENT_TYPES) {
      const fixture = EVENT_FIXTURES[type];
      expect(fixture, type).toBeDefined();
      const schema = EVENT_PAYLOADS[type][1];
      expect(schema.safeParse(fixture).success, `${type} fixture`).toBe(true);
      expect(invalidationsFor(type, 1, fixture), type).toEqual(EXPECTED[type]);
    }
    expect(invalidationsFor('learning.ledger.merged', 1, EVENT_FIXTURES['learning.ledger.merged'])).toBe('all');
  });

  it('UT-WEB-028 invalidationsFor는 모르는 type·버전·payload 파싱 실패를 all로 보고 verdict.revised 키 4개 값은 payload에서 온다 [IR-016]', () => {
    expect(invalidationsFor('unknown.type.happened', 1, {})).toBe('all');
    expect(invalidationsFor('learning.mastery.changed', 2, EVENT_FIXTURES['learning.mastery.changed'])).toBe('all');
    expect(invalidationsFor('learning.mastery.changed', 1, { concept_id: 7 })).toBe('all');
    expect(invalidationsFor('ops.health.changed', 1, null)).toBe('all');
    const payload = {
      ...EVENT_FIXTURES['grading.verdict.revised'],
      supersedes_verdict_id: '01J0000000000000000000000X',
    };
    const keys = invalidationsFor('grading.verdict.revised', 1, payload);
    expect(keys).toEqual([
      ['verdict', '01J0000000000000000000000X'],
      ['verdict', ULID_B],
      ['session', ULID_C],
      ['evidence', 'docker.dockerfile'],
    ]);
  });

  it('UT-WEB-029 qk 전 함수 출력이 표와 일치하고 *All()은 접두 무효화로 동작한다 [STD-WEB-10]', async () => {
    expect(qk.home()).toEqual(['home']);
    expect(qk.tracks()).toEqual(['tracks']);
    expect(qk.track('k8s')).toEqual(['track', 'k8s']);
    expect(qk.trackAll()).toEqual(['track']);
    expect(qk.concept('a.b')).toEqual(['concept', 'a.b']);
    expect(qk.conceptAll()).toEqual(['concept']);
    expect(qk.map()).toEqual(['map']);
    expect(qk.curationConflicts()).toEqual(['curation', 'conflicts']);
    expect(qk.curationReports()).toEqual(['curation', 'reports']);
    expect(qk.imports()).toEqual(['imports']);
    expect(qk.import('j')).toEqual(['import', 'j']);
    expect(qk.verdict('v')).toEqual(['verdict', 'v']);
    expect(qk.session('s')).toEqual(['session', 's']);
    expect(qk.sessionAll()).toEqual(['session']);
    expect(qk.evidence('e')).toEqual(['evidence', 'e']);
    expect(qk.evidenceAll()).toEqual(['evidence']);
    expect(qk.reviewWeekly()).toEqual(['review', 'weekly']);
    expect(qk.promotion('docker')).toEqual(['promotion', 'docker']);
    expect(qk.aiStatus()).toEqual(['ai', 'status']);
    expect(qk.aiWorkOrders()).toEqual(['ai', 'work-orders']);
    expect(qk.aiUsage()).toEqual(['ai', 'usage']);
    expect(qk.aiCalibration()).toEqual(['ai', 'calibration']);
    expect(qk.opsHealth()).toEqual(['ops', 'health']);
    expect(qk.opsBackups()).toEqual(['ops', 'backups']);

    const client = new QueryClient();
    client.setQueryData(qk.concept('a.b'), 1);
    client.setQueryData(qk.concept('c.d'), 2);
    client.setQueryData(qk.session('s'), 3);
    await client.invalidateQueries({ queryKey: qk.conceptAll() });
    expect(client.getQueryState(qk.concept('a.b'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.concept('c.d'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(qk.session('s'))?.isInvalidated).toBe(false);
    client.clear();
  });
});
