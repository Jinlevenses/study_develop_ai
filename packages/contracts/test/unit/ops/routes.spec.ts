import { describe, expect, it } from 'vitest';
import type { RouteDef } from '../../../src/common/route.js';
import { OP_AUTOSTART_ROUTES } from '../../../src/http/ops/v1/autostart.js';
import { OP_BACKUPS_ROUTES } from '../../../src/http/ops/v1/backups.js';
import { OP_DOCTOR_ROUTES } from '../../../src/http/ops/v1/doctor.js';
import { OP_ERRORS } from '../../../src/http/ops/v1/errors.js';
import { OP_HEALTH_ROUTES } from '../../../src/http/ops/v1/health.js';
import { OP_LOGS_ROUTES } from '../../../src/http/ops/v1/logs.js';
import { OP_OPERATIONS_ROUTES } from '../../../src/http/ops/v1/operations.js';
import { OP_SYSTEM_ROUTES } from '../../../src/http/ops/v1/system.js';
import { OP_TELEMETRY_ROUTES } from '../../../src/http/ops/v1/telemetry.js';
import { OP_TIMELINE_ROUTES } from '../../../src/http/ops/v1/timeline.js';
import { OP_TRANSFER_ROUTES } from '../../../src/http/ops/v1/transfer.js';
import { OP_UPGRADE_ROUTES } from '../../../src/http/ops/v1/upgrade.js';

// IF-01 §8 표 28행(IF-ID · 메서드 · 경로 · route id · 호출자 · 멱등) — 호출자 기본 = ['gateway'](§8 머리말).
type Row = readonly [string, string, string, string, readonly string[], boolean];
const EXPECTED: readonly Row[] = [
  ['IF-OP-001', 'GET', '/internal/v1/health-board', 'ops.health.board', ['gateway'], false],
  ['IF-OP-002', 'POST', '/internal/v1/banners/{banner_id}:dismiss', 'ops.banners.dismiss', ['gateway'], true],
  ['IF-OP-003', 'GET', '/internal/v1/operations/{op_id}', 'ops.operations.get', ['gateway'], false],
  ['IF-OP-004', 'GET', '/internal/v1/operations', 'ops.operations.list', ['gateway'], false],
  ['IF-OP-010', 'POST', '/internal/v1/backups:run', 'ops.backups.run', ['gateway'], true],
  ['IF-OP-011', 'GET', '/internal/v1/backups', 'ops.backups.list', ['gateway'], false],
  ['IF-OP-012', 'POST', '/internal/v1/restores', 'ops.restores.create', ['gateway'], true],
  ['IF-OP-013', 'GET', '/internal/v1/backups/{epoch_id}', 'ops.backups.get', ['gateway'], false],
  ['IF-OP-014', 'GET', '/internal/v1/backups/secondary', 'ops.backups.secondary', ['gateway'], false],
  ['IF-OP-015', 'PUT', '/internal/v1/backups/secondary', 'ops.backups.secondary_put', ['gateway'], true],
  ['IF-OP-016', 'POST', '/internal/v1/backups/secondary:unlock', 'ops.backups.secondary_unlock', ['gateway'], true],
  ['IF-OP-020', 'POST', '/internal/v1/exports', 'ops.exports.create', ['gateway'], true],
  ['IF-OP-021', 'POST', '/internal/v1/imports', 'ops.imports.create', ['gateway'], true],
  ['IF-OP-025', 'GET', '/internal/v1/doctor', 'ops.doctor.last', ['gateway'], false],
  ['IF-OP-026', 'POST', '/internal/v1/doctor:run', 'ops.doctor.run', ['gateway'], true],
  ['IF-OP-030', 'POST', '/internal/v1/upgrade/prepare', 'ops.upgrade.prepare', ['gateway'], true],
  ['IF-OP-031', 'POST', '/internal/v1/upgrade/rollback', 'ops.upgrade.rollback', ['gateway'], true],
  ['IF-OP-032', 'GET', '/internal/v1/upgrade/status', 'ops.upgrade.status', ['gateway'], false],
  ['IF-OP-035', 'GET', '/internal/v1/autostart', 'ops.autostart.get', ['gateway'], false],
  ['IF-OP-036', 'PUT', '/internal/v1/autostart', 'ops.autostart.put', ['gateway'], true],
  ['IF-OP-040', 'GET', '/internal/v1/timeline', 'ops.timeline.get', ['gateway'], false],
  ['IF-OP-041', 'GET', '/internal/v1/logs', 'ops.logs.search', ['gateway'], false],
  ['IF-OP-042', 'GET', '/internal/v1/logs/tail', 'ops.logs.tail', ['gateway'], false],
  ['IF-OP-045', 'GET', '/internal/v1/telemetry/tripwires', 'ops.telemetry.tripwires', ['gateway'], false],
  ['IF-OP-046', 'GET', '/internal/v1/telemetry/slo', 'ops.telemetry.slo', ['gateway'], false],
  ['IF-OP-047', 'PUT', '/internal/v1/telemetry/settings', 'ops.telemetry.settings', ['gateway'], true],
  ['IF-OP-050', 'POST', '/internal/v1/system:shutdown', 'ops.system.shutdown', ['gateway'], true],
  ['IF-OP-051', 'POST', '/internal/v1/services/{svc}:restart', 'ops.services.restart', ['gateway'], true],
];

const FILES = {
  health: OP_HEALTH_ROUTES,
  operations: OP_OPERATIONS_ROUTES,
  backups: OP_BACKUPS_ROUTES,
  transfer: OP_TRANSFER_ROUTES,
  doctor: OP_DOCTOR_ROUTES,
  upgrade: OP_UPGRADE_ROUTES,
  autostart: OP_AUTOSTART_ROUTES,
  timeline: OP_TIMELINE_ROUTES,
  logs: OP_LOGS_ROUTES,
  telemetry: OP_TELEMETRY_ROUTES,
  system: OP_SYSTEM_ROUTES,
};
const ALL: readonly RouteDef[] = Object.values(FILES).flat();
const get = (id: string): RouteDef => {
  const r = ALL.find((x) => x.ifId === id);
  if (r === undefined) {
    throw new Error(`route ${id} missing`);
  }
  return r;
};

describe('ops 라우트 28개(IF-OP)', () => {
  it('UT-CON-166 OP_*_ROUTES 11개 합집합 ifId = §8 표, 전부 allowedCallers = [gateway], id 접두 ops., idempotent·응답 상태(202·204) 일치, OP-051 params.svc nope 통과 [FR-SET-001][FR-SET-015]', () => {
    expect(ALL).toHaveLength(28);
    expect(Object.values(FILES).map((f) => f.length)).toEqual([2, 2, 7, 2, 2, 3, 2, 1, 2, 3, 2]);
    expect(new Set(ALL.map((r) => r.ifId)).size).toBe(28);
    expect(new Set(ALL.map((r) => r.id)).size).toBe(28);
    expect(ALL.map((r) => r.ifId).sort()).toEqual(EXPECTED.map((r) => r[0]).sort());
    for (const [ifId, method, path, id, callers, idem] of EXPECTED) {
      const r = get(ifId);
      expect(r.method, ifId).toBe(method);
      expect(r.path, ifId).toBe(path);
      expect(r.id, ifId).toBe(id);
      expect(r.id.startsWith('ops.'), ifId).toBe(true);
      expect(r.path.startsWith('/internal/v1/'), ifId).toBe(true);
      expect([...r.allowedCallers], ifId).toEqual(['gateway']);
      expect(callers).toEqual(['gateway']);
      expect(r.idempotent, ifId).toBe(idem);
      expect(r.deadlineMs, ifId).toBeUndefined();
      expect(r.responseKind, ifId).toBeUndefined();
    }
    // 응답 상태: 장기 작업 = 202(Operation), 배너 해제 = 204, 그 밖 = 200
    const accepted = [
      'IF-OP-010',
      'IF-OP-012',
      'IF-OP-020',
      'IF-OP-021',
      'IF-OP-026',
      'IF-OP-030',
      'IF-OP-031',
      'IF-OP-050',
      'IF-OP-051',
    ];
    for (const r of ALL) {
      const status = accepted.includes(r.ifId) ? 202 : r.ifId === 'IF-OP-002' ? 204 : 200;
      expect(Object.keys(r.response), r.ifId).toEqual([String(status)]);
    }
    expect(get('IF-OP-002').response[204]?.safeParse(null).success).toBe(true);
    expect(
      ALL.filter((r) => r.paginated)
        .map((r) => r.ifId)
        .sort(),
    ).toEqual(['IF-OP-004', 'IF-OP-011', 'IF-OP-041']);
    // freeze·slice: 'R1(수동)·D → R3(리허설 자동)' → R1·D, 'R1·D(ledger)·R3(왕복 완성)' → R1·D
    const fs = (id: string) => `${get(id).freeze}${get(id).slice}`;
    expect([
      fs('IF-OP-001'),
      fs('IF-OP-012'),
      fs('IF-OP-020'),
      fs('IF-OP-026'),
      fs('IF-OP-030'),
      fs('IF-OP-050'),
    ]).toEqual(['DR0', 'DR1', 'DR1', 'DR1', 'OR3', 'DR0']);
    expect([...get('IF-OP-032').fr]).toEqual(['FR-SET-007']);
    expect([...get('IF-OP-046').fr]).toEqual(['NFR-PERF-*', 'TW-12']);
    // params: 서비스 이름은 정규식만(존재 검사는 서비스 몫, OP-NOTFOUND-004)
    const svc = get('IF-OP-051').request.params;
    expect(svc?.safeParse({ svc: 'nope' }).success).toBe(true);
    expect(svc?.safeParse({ svc: 'ai-gateway' }).success).toBe(true);
    expect(svc?.safeParse({ svc: 'No Way' }).success).toBe(false);
    expect(svc?.safeParse({ svc: 'a'.repeat(41) }).success).toBe(false);
    expect(get('IF-OP-013').request.params?.safeParse({ epoch_id: '01HZX3Y5K7M9N2P4Q6R8S0T1V2' }).success).toBe(true);
    expect(get('IF-OP-013').request.params?.safeParse({ epoch_id: 'latest' }).success).toBe(false);
    expect(get('IF-OP-002').request.params?.safeParse({ banner_id: '01HZX3Y5K7M9N2P4Q6R8S0T1V2' }).success).toBe(true);
    // 요청 스키마 연결
    expect(get('IF-OP-040').request.query?.safeParse({ correlation_id: '01HZX3Y5K7M9N2P4Q6R8S0T1V2' }).success).toBe(
      true,
    );
    expect(get('IF-OP-042').request.query?.safeParse({ svc: 'supervisor', n: '10' }).success).toBe(true);
    expect(get('IF-OP-015').request.body?.safeParse({ path: null, encrypt: false, passphrase: null }).success).toBe(
      true,
    );
    // 파일 위치 규칙: OP-012는 backups.ts에 있다
    expect(OP_BACKUPS_ROUTES.map((r) => r.ifId)).toEqual([
      'IF-OP-010',
      'IF-OP-011',
      'IF-OP-012',
      'IF-OP-013',
      'IF-OP-014',
      'IF-OP-015',
      'IF-OP-016',
    ]);
  });

  it('UT-CON-167 OP_ERRORS 9키 = §2.6.3 OP 행, OP-CONFLICT-011·OP-VAL-010 status 422 [IR-015][STD-ERR-01]', () => {
    expect(Object.keys(OP_ERRORS)).toEqual([
      'OP-CONFLICT-010',
      'OP-CONFLICT-011',
      'OP-VAL-010',
      'OP-VAL-011',
      'OP-NOTFOUND-001',
      'OP-NOTFOUND-002',
      'OP-NOTFOUND-003',
      'OP-NOTFOUND-004',
      'OP-DEP-001',
    ]);
    for (const [code, e] of Object.entries(OP_ERRORS)) {
      expect(code).toMatch(/^OP-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/);
      expect(e.retryable, code).toBe([429, 502, 503, 504].includes(e.status));
      expect(e.title.length, code).toBeGreaterThan(0);
    }
    expect(OP_ERRORS['OP-CONFLICT-011'].status).toBe(422);
    expect(OP_ERRORS['OP-VAL-010'].status).toBe(422);
    expect(OP_ERRORS['OP-VAL-011'].status).toBe(422);
    expect(OP_ERRORS['OP-CONFLICT-010'].status).toBe(409);
    expect(OP_ERRORS['OP-NOTFOUND-004'].status).toBe(404);
    expect(OP_ERRORS['OP-DEP-001']).toMatchObject({ status: 503, retryable: true });
    expect(OP_ERRORS['OP-VAL-010'].title).toBe('경로 무효');
  });
});
