import path from 'node:path';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import type { InstallPackRequest, PackInstallView } from '@fathom/contracts/http/content/v1/catalog';
import type { AppError, Result } from '@fathom/shared-kernel/errors/errors';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from './support/context.js';
import { createCtx } from './support/context.js';
import { rows, scalar } from './support/db.js';
import type { PackSpec } from './support/fpack-writer.js';
import { writeFpack } from './support/fpack-writer.js';
import { stageInstall } from './support/stage.js';

let c: Ctx;
beforeEach(async () => {
  c = await createCtx();
});
afterEach(() => {
  c.fx.close();
});

const BUNDLED = { kind: 'bundled', track: null } as const;
const V1: PackSpec = {
  version: '1.0.0',
  concepts: [
    { slug: 'pod', level: 1 },
    { slug: 'service', level: 2, tier: 'C', prereqs: ['pod'] },
    { slug: 'old', level: 1 },
    { slug: 'node', level: 1 },
  ],
};
const V2: PackSpec = {
  version: '1.1.0',
  concepts: [
    { slug: 'pod', level: 1, rev: 1, ku_rev: 1 },
    { slug: 'service', level: 2, tier: 'B', prereqs: ['pod'] },
    { slug: 'old', level: 1, deprecated_by: 'k8s.pod' },
    { slug: 'node', level: 1, ku_rev: 1 },
    { slug: 'ingress', level: 3, prereqs: ['service', 'pod'] },
  ],
};

function must(res: Result<PackInstallView, AppError>): PackInstallView {
  if (!res.ok) {
    throw new Error(`install rejected: ${res.error.code} ${res.error.detail ?? ''}`);
  }
  return res.value;
}
function rejected(res: Result<PackInstallView, AppError>): AppError {
  if (res.ok) {
    throw new Error('expected a rejection');
  }
  return res.error;
}
async function installAndWait(
  source: InstallPackRequest['source'] = BUNDLED,
  over: Partial<InstallPackRequest> = {},
): Promise<PackInstallView> {
  const first = must(c.installer.install(c.req(source, over)));
  await c.installer.idle();
  const done = c.installer.get(first.install_id);
  if (done === null) {
    throw new Error('view lost');
  }
  return done;
}
const count = (sql: string, bind: Record<string, string | number | null> = {}): number => scalar(c.fx.db, sql, bind);
const snapshot = (): unknown => ({
  packs: rows(c.fx.db, 'SELECT install_id, state, state_reason FROM ct_pack ORDER BY install_id'),
  active: rows(c.fx.db, 'SELECT * FROM ct_pack_active ORDER BY pack_id'),
  outbox: count('SELECT count(*) FROM outbox'),
  versions: rows(
    c.fx.db,
    'SELECT install_id, concept_id, json_extract(ext, \'$."catalog.version"\') AS v FROM ct_concept ORDER BY install_id, concept_id',
  ),
});

describe('PackInstaller (설치 유스케이스)', () => {
  it('UT-CT-001 .fpack 파일 해시 불일치·merkle 불일치는 각각 CT-VAL-011로 거부하고 행·포인터·outbox를 바꾸지 않는다 [FR-CUR-002][FR-SET-014]', async () => {
    // Arrange: 정상 v1이 이미 활성이다.
    c.put(V1);
    expect((await installAndWait()).state).toBe('activated');
    const before = snapshot();
    const jobCalls = c.jobs.calls.length;
    // Act / Assert: 파일 해시(files[]) 불일치
    const badFile = writeFpack(
      path.join(c.fx.home.home, 'bad'),
      { ...V2 },
      {
        refreshFiles: false,
        parts: (p) => {
          p.manifest.files = p.manifest.files.length === 0 ? [] : p.manifest.files;
          p.manifest.files = [
            { path: 'bundle.jsonl', sha256: '0'.repeat(64), bytes: 1 },
            { path: 'report.json', sha256: '0'.repeat(64), bytes: 1 },
            { path: 'layout.json', sha256: '0'.repeat(64), bytes: 1 },
          ];
        },
      },
    ).file;
    const e1 = rejected(c.installer.install(c.req({ kind: 'file', path: badFile })));
    expect(e1).toMatchObject({ code: 'CT-VAL-011', status: 422, detail: 'file_hash_mismatch' });
    // merkle 불일치
    const badMerkle = writeFpack(path.join(c.fx.home.home, 'bad2'), V2, {
      parts: (p) => {
        p.manifest.merkle_root = 'c'.repeat(64);
      },
    }).file;
    const e2 = rejected(c.installer.install(c.req({ kind: 'file', path: badMerkle })));
    expect(e2).toMatchObject({ code: 'CT-VAL-011', detail: 'merkle_mismatch' });
    // 아무것도 바뀌지 않았다 — 새 ct_pack 행 0·포인터·outbox·job 호출
    expect(snapshot()).toEqual(before);
    expect(c.jobs.calls).toHaveLength(jobCalls);
  });

  it('UT-CT-001 첫 설치 요청이 검증 실패하면 ct_pack 행이 0개다 [FR-CUR-002][FR-SET-014]', () => {
    const bad = writeFpack(c.packsDir, V1, {
      parts: (p) => {
        p.manifest.merkle_root = 'c'.repeat(64);
      },
    }).file;
    expect(bad).toContain('k8s@1.0.0.fpack');
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({
      code: 'CT-VAL-011',
      detail: 'merkle_mismatch',
    });
    expect(count('SELECT count(*) FROM ct_pack')).toBe(0);
    expect(count('SELECT count(*) FROM ct_pack_active')).toBe(0);
    expect(count('SELECT count(*) FROM outbox')).toBe(0);
  });

  it('UT-CT-001 원천 해석 오류 — 번들 0개·user_dir·상대 경로·채널 불일치 [FR-CUR-002][CR-46]', () => {
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({ code: 'CT-NOTFOUND-003' });
    expect(rejected(c.installer.install(c.req({ kind: 'user_dir', dir: '/x' })))).toMatchObject({
      code: 'CT-VAL-011',
      detail: 'user_dir unsupported in R0',
    });
    expect(rejected(c.installer.install(c.req({ kind: 'file', path: 'relative/k8s@1.0.0.fpack' })))).toMatchObject({
      code: 'CT-VAL-011',
    });
    c.put(V1);
    expect(rejected(c.installer.install(c.req(BUNDLED, { channel: 'local' })))).toMatchObject({
      code: 'CT-VAL-011',
      detail: 'channel_mismatch',
    });
    expect(
      rejected(c.installer.install(c.req({ kind: 'file', path: path.join(c.packsDir, 'missing.fpack') }))),
    ).toMatchObject({
      code: 'CT-VAL-011',
      detail: 'file_invalid',
    });
    expect(count('SELECT count(*) FROM ct_pack')).toBe(0);
  });

  it('UT-CT-030 활성 설치에 있던 개념이 새 번들에 없으면 concept_removed로 거부하고, deprecated_by 폐기는 허용한다 [FR-CUR-004]', async () => {
    // Arrange
    c.put(V1);
    await installAndWait();
    const before = snapshot();
    c.put({ version: '1.1.0', concepts: [{ slug: 'pod' }, { slug: 'old' }, { slug: 'node' }] }); // service 삭제
    // Act / Assert
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({
      code: 'CT-VAL-011',
      detail: 'concept_removed:k8s.service',
    });
    expect(snapshot()).toEqual(before);
    // 같은 개념을 deprecated_by로 폐기하면 통과한다.
    c.put({
      version: '1.2.0',
      concepts: [{ slug: 'pod' }, { slug: 'service', deprecated_by: 'k8s.pod' }, { slug: 'old' }, { slug: 'node' }],
    });
    expect((await installAndWait()).state).toBe('activated');
  });

  it('UT-CT-040 활성화는 포인터 전환·이전 설치 은퇴·핸들러 activate를 한 tx에서 한다 [CR-12][FR-CUR-001]', async () => {
    // Arrange / Act: v1 → v2
    c.put(V1);
    const first = await installAndWait();
    const v1Install = String(
      c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE version = '1.0.0'").get()?.install_id,
    );
    expect(first).toMatchObject({
      state: 'activated',
      problem: null,
      packs: [{ pack_id: 'k8s', version: '1.0.0', previous_version: null }],
    });
    expect(rows(c.fx.db, 'SELECT pack_id, install_id, previous_install_id FROM ct_pack_active')).toEqual([
      { pack_id: 'k8s', install_id: v1Install, previous_install_id: null },
    ]);
    c.fx.clock.advance(5000);
    c.put(V2);
    const second = await installAndWait();
    // Assert
    const v2Install = String(
      c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE version = '1.1.0'").get()?.install_id,
    );
    expect(second.packs).toEqual([
      { pack_id: 'k8s', track: 'k8s', version: '1.1.0', previous_version: '1.0.0', conflicts: 0 },
    ]);
    expect(rows(c.fx.db, 'SELECT pack_id, install_id, previous_install_id, switched_at FROM ct_pack_active')).toEqual([
      { pack_id: 'k8s', install_id: v2Install, previous_install_id: v1Install, switched_at: c.fx.clock.now() },
    ]);
    expect(rows(c.fx.db, 'SELECT version, state, retired_at, activated_at FROM ct_pack ORDER BY version')).toEqual([
      { version: '1.0.0', state: 'retired', retired_at: c.fx.clock.now(), activated_at: c.fx.clock.now() - 5000 },
      { version: '1.1.0', state: 'active', retired_at: null, activated_at: c.fx.clock.now() },
    ]);
    // 은퇴 설치의 행은 보존된다(blue/green).
    expect(count('SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: v1Install })).toBe(4);
    expect(c.handler.activations).toEqual([
      {
        pack_id: 'k8s',
        install_id: expect.any(String),
        previous_install_id: null,
        switched_at: c.fx.clock.now() - 5000,
      },
      { pack_id: 'k8s', install_id: v2Install, previous_install_id: v1Install, switched_at: c.fx.clock.now() },
    ]);
    expect(c.handler.activateInTx).toEqual([true, true]); // 훅은 활성화 tx 안에서 불린다
    // 로그에는 파일 경로가 없다(STD-LOG-22).
    expect(c.log.lines.join('')).not.toContain(c.fx.home.home);
  });

  it('UT-CT-041 outbox 순서(concept.changed… → pack.activated)·payload가 EVENT_PAYLOADS를 통과하고 변경 분류·버전이 맞다 [CR-12][CR-41][FR-CUR-001]', async () => {
    // Arrange
    c.put(V1);
    const first = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const afterV1 = c.events();
    // Assert v1: 개념 4건 published(concept_id 순) → pack.activated
    expect(afterV1.map((e) => e.type)).toEqual([
      'catalog.concept.changed',
      'catalog.concept.changed',
      'catalog.concept.changed',
      'catalog.concept.changed',
      'catalog.pack.activated',
    ]);
    expect(afterV1.every((e) => e.correlation_id === first.install_id)).toBe(true);
    expect(afterV1.slice(0, 4).map((e) => (e.payload.concept as { concept_id: string }).concept_id)).toEqual([
      'k8s.node',
      'k8s.old',
      'k8s.pod',
      'k8s.service',
    ]);
    expect(
      afterV1
        .slice(0, 4)
        .every((e) => e.payload.change === 'published' && (e.payload.concept as { version: number }).version === 1),
    ).toBe(true);
    expect(afterV1[4]?.payload).toMatchObject({
      pack_id: 'k8s',
      track: 'k8s',
      version: '1.0.0',
      channel: 'seed',
      previous_version: null,
      catalog_version: 1,
      offline_cap_level: 2,
      changed_concept_ids: ['k8s.node', 'k8s.old', 'k8s.pod', 'k8s.service'],
      activated_at: c.fx.clock.now(),
    });
    // Act: v2
    c.put(V2);
    const second = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const v2Events = c.events().slice(5);
    // Assert v2
    expect(
      v2Events.map(
        (e) =>
          `${e.type}:${String((e.payload.concept as { concept_id?: string } | undefined)?.concept_id ?? '')}:${String(e.payload.change ?? '')}`,
      ),
    ).toEqual([
      'catalog.concept.changed:k8s.ingress:published',
      'catalog.concept.changed:k8s.old:deprecated',
      'catalog.concept.changed:k8s.pod:revised',
      'catalog.concept.changed:k8s.service:tier_promoted',
      'catalog.pack.activated::',
    ]);
    for (const e of c.events()) {
      const schema = EVENT_PAYLOADS[e.type as 'catalog.pack.activated'][1];
      expect(schema.safeParse(e.payload).success, e.type).toBe(true);
    }
    expect(v2Events.every((e) => e.correlation_id === second.install_id)).toBe(true);
    expect(v2Events[4]?.payload).toMatchObject({
      previous_version: '1.0.0',
      catalog_version: 2,
      changed_concept_ids: ['k8s.ingress', 'k8s.old', 'k8s.pod', 'k8s.service'],
      changed_ku_ids: ['k8s.ingress.k01', 'k8s.node.k01', 'k8s.pod.k01'], // node는 KU만 바뀌어 개념 이벤트는 없다
    });
    const ingress = v2Events[0]?.payload.concept as { prereq_ids: string[]; version: number; tier: string };
    expect(ingress).toMatchObject({ prereq_ids: ['k8s.pod', 'k8s.service'], version: 2 });
    // 개념 ext."catalog.version": 바뀐 개념 = 2, 바뀌지 않은 개념(node) = 이전 값(1)을 이어받는다.
    expect(
      rows(
        c.fx.db,
        'SELECT concept_id, json_extract(ext, \'$."catalog.version"\') AS v FROM ct_concept_active ORDER BY concept_id',
      ),
    ).toEqual([
      { concept_id: 'k8s.ingress', v: 2 },
      { concept_id: 'k8s.node', v: 1 },
      { concept_id: 'k8s.old', v: 2 },
      { concept_id: 'k8s.pod', v: 2 },
      { concept_id: 'k8s.service', v: 2 },
    ]);
    expect(count("SELECT json_extract(ext, '$.\"catalog.version\"') FROM ct_pack WHERE state = 'active'")).toBe(2);
  });

  it('UT-CT-042 activate 훅이 던지면 포인터·상태·outbox가 그대로이고 새 행은 failed(activation_failed)다 [CR-12]', async () => {
    // Arrange: v1 활성
    c.put(V1);
    await installAndWait();
    const before = snapshot();
    c.handler.failActivate = true;
    c.put(V2);
    // Act
    const view = await installAndWait();
    // Assert
    expect(view.state).toBe('failed');
    expect(view.problem).toMatchObject({
      code: 'CT-INTERNAL-900',
      detail: 'pack_load:activation_failed',
      retryable: false,
    });
    const after = snapshot() as {
      packs: { state: string; state_reason: string | null }[];
      active: unknown;
      outbox: number;
    };
    const prev = before as typeof after;
    expect(after.active).toEqual(prev.active);
    expect(after.outbox).toBe(prev.outbox);
    expect(after.packs.map((p) => p.state).sort()).toEqual(['active', 'failed']);
    expect(after.packs.find((p) => p.state === 'failed')?.state_reason).toBe('pack_load:activation_failed');
    expect(count('SELECT count(*) FROM ct_concept_active WHERE json_extract(ext, \'$."catalog.version"\') = 1')).toBe(
      4,
    );
    // 실패 행에는 error_id가 있고 다음 설치 요청이 failed 행을 정리한 뒤 성공한다.
    expect(count('SELECT count(*) FROM ct_pack WHERE json_extract(ext, \'$."catalog.error_id"\') IS NOT NULL')).toBe(1);
    c.handler.failActivate = false;
    const retry = await installAndWait();
    expect(retry.state).toBe('activated');
    expect(count("SELECT count(*) FROM ct_pack WHERE state = 'failed'")).toBe(0);
  });

  it('UT-CT-043 같은 버전·같은 hash 재요청은 noop(행·이벤트·job 0, view activated), 되돌림은 allow_downgrade로 reactivate(job 없음) [CR-12]', async () => {
    // Arrange
    c.put(V1);
    await installAndWait();
    // 개념을 더하지 않는 v2(개념 제거 금지 규칙이 되돌림을 막지 않는다)
    c.put({ ...V2, concepts: V2.concepts.filter((x) => x.slug !== 'ingress') });
    await installAndWait();
    const rowsBefore = count('SELECT count(*) FROM ct_pack');
    const eventsBefore = count('SELECT count(*) FROM outbox');
    const jobsBefore = c.jobs.calls.length;
    // Act 1: v2 다시 요청 = noop
    const again = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    // Assert 1
    expect(again).toMatchObject({
      state: 'activated',
      problem: null,
      packs: [{ pack_id: 'k8s', version: '1.1.0', previous_version: null }],
    });
    expect(again.finished_at).toBe(again.started_at);
    expect(c.installer.get(again.install_id)).toMatchObject({ state: 'activated' });
    expect(count('SELECT count(*) FROM ct_pack')).toBe(rowsBefore);
    expect(count('SELECT count(*) FROM outbox')).toBe(eventsBefore);
    expect(c.jobs.calls).toHaveLength(jobsBefore);
    // Act 2: v1(은퇴됨)을 allow_downgrade로 되살린다 — 하향이므로 플래그 없이는 거부
    const v1File = path.join(c.packsDir, 'k8s@1.0.0.fpack');
    expect(rejected(c.installer.install(c.req({ kind: 'file', path: v1File })))).toMatchObject({
      code: 'CT-CONFLICT-013',
    });
    const back = must(c.installer.install(c.req({ kind: 'file', path: v1File }, { allow_downgrade: true })));
    await c.installer.idle();
    // Assert 2
    expect(c.installer.get(back.install_id)).toMatchObject({
      state: 'activated',
      packs: [{ version: '1.0.0', previous_version: '1.1.0' }],
    });
    expect(c.jobs.calls).toHaveLength(jobsBefore); // 다시 적재하지 않는다
    expect(count('SELECT count(*) FROM ct_pack')).toBe(rowsBefore);
    expect(rows(c.fx.db, 'SELECT version, state FROM ct_pack ORDER BY version')).toEqual([
      { version: '1.0.0', state: 'active' },
      { version: '1.1.0', state: 'retired' },
    ]);
    const last = c.events().at(-1);
    expect(last).toMatchObject({
      type: 'catalog.pack.activated',
      payload: { version: '1.0.0', previous_version: '1.1.0', catalog_version: 3 },
    });
  });

  it('UT-CT-043 같은 버전인데 다른 manifest면 CT-CONFLICT-013(version_conflict) [CR-12]', async () => {
    c.put(V1);
    await installAndWait();
    const other = writeFpack(path.join(c.fx.home.home, 'alt'), { ...V1, created_at: 1_790_000_999_000 }).file;
    expect(rejected(c.installer.install(c.req({ kind: 'file', path: other })))).toMatchObject({
      code: 'CT-CONFLICT-013',
      status: 409,
    });
  });

  it('UT-CT-044 recoverInterrupted는 loading·ready로 남은 설치를 failed(interrupted)로 돌리고 활성 행은 건드리지 않는다 [FR-CUR-001][CR-12]', async () => {
    // Arrange: 활성 1개 + 중단된 loading 1개 + ready 1개
    c.put(V1);
    await installAndWait();
    const loading = stageInstall(c.fx, { ...V2, track: 'db', concepts: [{ slug: 'index' }] });
    const ready = stageInstall(c.fx, { ...V2, track: 'net', concepts: [{ slug: 'tcp' }] });
    c.fx.db.prepare("UPDATE ct_pack SET state = 'ready' WHERE install_id = :i").run({ i: ready.installId });
    // Act
    const n = c.installer.recoverInterrupted();
    // Assert
    expect(n).toBe(2);
    expect(rows(c.fx.db, 'SELECT pack_id, state, state_reason FROM ct_pack ORDER BY pack_id')).toEqual([
      { pack_id: 'db', state: 'failed', state_reason: 'interrupted' },
      { pack_id: 'k8s', state: 'active', state_reason: null },
      { pack_id: 'net', state: 'failed', state_reason: 'interrupted' },
    ]);
    expect(c.installer.recoverInterrupted()).toBe(0);
    expect(c.installer.get(loading.requestId)).toMatchObject({
      state: 'failed',
      problem: { code: 'CT-INTERNAL-900', detail: 'interrupted' },
    });
  });

  it('UT-CT-033 진행 중 재요청은 CT-CONFLICT-013, job 슬롯이 차면 CT-DEP-002, 알 수 없는 install_id는 null이다 [CR-12]', async () => {
    c.put(V1);
    const first = must(c.installer.install(c.req(BUNDLED)));
    expect(first.state).toBe('loading');
    expect(c.installer.get(first.install_id)).toMatchObject({ state: 'loading', finished_at: null });
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({ code: 'CT-CONFLICT-013', status: 409 });
    await c.installer.idle();
    c.put(V2);
    c.jobs.busy = true;
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({ code: 'CT-DEP-002', status: 503 });
    c.jobs.busy = false;
    expect(c.installer.get(fixedUlid(999))).toBeNull();
    await c.installer.idle();
  });

  it('UT-CT-033 job이 실패하면 그 행은 failed(pack_load:<코드>), 남은 팩은 failed(aborted)이고 이미 활성인 팩은 유지된다 [FR-CUR-002][CR-12]', async () => {
    // Arrange: 팩 3개(db < k8s < net 순서로 처리). k8s에서 실패시킨다.
    c.put({ track: 'db', concepts: [{ slug: 'index' }] });
    c.put({ track: 'k8s', concepts: [{ slug: 'pod' }] });
    c.put({ track: 'net', concepts: [{ slug: 'tcp' }] });
    c.jobs.failWith = (args) => (String(args.fpack_path).includes('k8s@') ? 'merkle_mismatch' : null);
    // Act
    const view = await installAndWait();
    // Assert
    expect(c.jobs.calls.map((j) => path.basename(String(j.args.fpack_path)))).toEqual([
      'db@1.0.0.fpack',
      'k8s@1.0.0.fpack',
    ]);
    expect(rows(c.fx.db, 'SELECT pack_id, state, state_reason FROM ct_pack ORDER BY pack_id')).toEqual([
      { pack_id: 'db', state: 'active', state_reason: null },
      { pack_id: 'k8s', state: 'failed', state_reason: 'pack_load:merkle_mismatch' },
      { pack_id: 'net', state: 'failed', state_reason: 'aborted' },
    ]);
    expect(view.state).toBe('failed');
    expect(view.problem?.detail).toBe('pack_load:merkle_mismatch');
    expect(view.packs.map((p) => p.pack_id)).toEqual(['db', 'k8s', 'net']);
    expect(count('SELECT count(*) FROM ct_pack_active')).toBe(1);
    // 코드 모양이 아닌 메시지(경로·SQL 가능)는 internal로 가린다.
    c.jobs.failWith = () => 'SELECT * FROM x at /home/secret/path';
    const again = await installAndWait();
    expect(again.problem?.detail).toBe('pack_load:internal');
  });
});
