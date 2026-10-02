import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PackInstallView } from '@fathom/contracts/http/content/v1/catalog';
import type { AppError, Result } from '@fathom/shared-kernel/errors/errors';
import type { JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { afterEach, describe, expect, it } from 'vitest';
import { createCatalogQuery } from '../../../src/application/catalog/catalog-query.js';
import { exportCurriculum } from '../../../src/application/catalog/export-curriculum.js';
import { createPackInstaller } from '../../../src/application/catalog/install-pack.js';
import { rows, scalar } from '../../unit/catalog/support/db.js';
import type { PackSpec } from '../../unit/catalog/support/fpack-writer.js';
import { buildFpack, bulkConcepts } from '../../unit/catalog/support/fpack-writer.js';
import { stageInstall } from '../../unit/catalog/support/stage.js';
import type { RealCtx } from './support.js';
import { createRealCtx } from './support.js';

// IT-230~238 — 실제 단명 자식 프로세스(`job-entry.ts` = makePackLoadJob) + 부모 PackInstaller + 실제 outbox + 마이그레이션된 임시 홈.

let ctx: RealCtx | null = null;
afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const BUNDLED = { kind: 'bundled', track: null } as const;
const must = (res: Result<PackInstallView, AppError>): PackInstallView => {
  if (!res.ok) {
    throw new Error(`install rejected: ${res.error.code} ${res.error.detail ?? ''}`);
  }
  return res.value;
};
const rejected = (res: Result<PackInstallView, AppError>): AppError => {
  if (res.ok) {
    throw new Error('expected rejection');
  }
  return res.error;
};
const count = (c: RealCtx, sql: string, bind: Record<string, string | number | null> = {}): number =>
  scalar(c.fx.db, sql, bind);

const K8S_V1: PackSpec = {
  version: '1.0.0',
  concepts: [
    { slug: 'pod', level: 1, kus: 2, mcs: 1, items: 2 },
    { slug: 'service', level: 2, prereqs: ['pod'] },
  ],
};
const K8S_V2: PackSpec = {
  version: '1.1.0',
  concepts: [
    { slug: 'pod', level: 1, kus: 2, mcs: 1, items: 2, rev: 1 },
    { slug: 'service', level: 2, prereqs: ['pod'] },
    { slug: 'ingress', level: 3, prereqs: ['service'] },
  ],
};

describe('PackInstaller × 실제 job 자식 (통합)', () => {
  it('IT-230 bundled 2팩 설치 → 둘 다 active·행 수·이벤트·문항 핸들러 호출 [FR-CUR-002][FR-SET-014][CR-12]', async () => {
    // Arrange
    ctx = await createRealCtx();
    const c = ctx;
    c.put(K8S_V1);
    c.put({
      track: 'db',
      version: '2.0.0',
      concepts: [{ slug: 'index' }, { slug: 'mvcc', level: 2, prereqs: ['index'] }],
    });
    // Act
    const view = must(c.installer.install(c.req(BUNDLED)));
    expect(view.state).toBe('loading');
    await c.installer.idle();
    // Assert
    expect(c.installer.get(view.install_id)).toMatchObject({
      state: 'activated',
      problem: null,
      packs: [
        { pack_id: 'db', version: '2.0.0', previous_version: null },
        { pack_id: 'k8s', version: '1.0.0', previous_version: null },
      ],
    });
    expect(
      rows(c.fx.db, 'SELECT pack_id, state, source_sha256 IS NOT NULL AS has_sha FROM ct_pack ORDER BY pack_id'),
    ).toEqual([
      { pack_id: 'db', state: 'active', has_sha: 1 },
      { pack_id: 'k8s', state: 'active', has_sha: 1 },
    ]);
    expect(count(c, 'SELECT count(*) FROM ct_concept_active')).toBe(4);
    expect(count(c, 'SELECT count(*) FROM ct_ku_active')).toBe(5);
    expect(count(c, 'SELECT count(*) FROM ct_misconception_active')).toBe(1);
    expect(count(c, 'SELECT count(*) FROM ct_pack_active')).toBe(2);
    // 이벤트: 팩 처리 순서(db → k8s)대로 개념 변경 → pack.activated
    expect(c.events().map((e) => e.type)).toEqual([
      'catalog.concept.changed',
      'catalog.concept.changed',
      'catalog.pack.activated',
      'catalog.concept.changed',
      'catalog.concept.changed',
      'catalog.pack.activated',
    ]);
    expect(c.events().every((e) => e.correlation_id === view.install_id)).toBe(true);
    // 자식(job)이 가짜 문항 핸들러를 문항 2건으로 1회 호출했고, 부모는 활성화 훅을 팩마다 호출했다.
    const k8sInstall = String(
      c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE pack_id = 'k8s'").get()?.install_id,
    );
    expect(c.ingestLog()).toEqual([`ingest ${k8sInstall} 2`]);
    expect(c.handler.activations.map((a) => a.pack_id)).toEqual(['db', 'k8s']);
    expect(
      createCatalogQuery(c.fx.db)
        .listPacks()
        .packs.map((p) => p.pack_id),
    ).toEqual(['db', 'k8s']);
  });

  it('IT-231 v1 활성 중 v2 적재 — 적재 동안 조회 = v1, 전환 후 v2, v1 행 보존(blue/green) [FR-CUR-002][CR-12]', async () => {
    // Arrange: v1 활성
    ctx = await createRealCtx();
    const c = ctx;
    c.put(K8S_V1);
    must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const query = createCatalogQuery(c.fx.db);
    expect(query.listPacks().packs[0]?.version).toBe('1.0.0');
    // Act: v2 요청 — 큰 팩(적재가 길도록)으로 올린다.
    c.put({
      ...K8S_V2,
      concepts: [
        ...K8S_V2.concepts,
        ...bulkConcepts(120, 3, 1).map((x) => ({ ...x, slug: `bulk${x.slug}`, prereqs: [] })),
      ],
    });
    const view = must(c.installer.install(c.req(BUNDLED)));
    // Assert: 적재가 끝날 때까지 읽기는 계속 v1을 본다(전환은 활성화 tx 1회).
    const seen = new Set<string>();
    while (c.installer.get(view.install_id)?.state === 'loading') {
      seen.add(`${query.listPacks().packs[0]?.version}/${count(c, 'SELECT count(*) FROM ct_concept_active')}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect([...seen]).toEqual(['1.0.0/2']);
    await c.installer.idle();
    expect(c.installer.get(view.install_id)).toMatchObject({ state: 'activated' });
    expect(query.listPacks().packs[0]?.version).toBe('1.1.0');
    expect(count(c, 'SELECT count(*) FROM ct_concept_active')).toBe(3 + 120);
    // v1 행 보존
    const v1 = String(c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE version = '1.0.0'").get()?.install_id);
    expect(rows(c.fx.db, 'SELECT version, state FROM ct_pack ORDER BY version')).toEqual([
      { version: '1.0.0', state: 'retired' },
      { version: '1.1.0', state: 'active' },
    ]);
    expect(count(c, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: v1 })).toBe(2);
    expect(count(c, 'SELECT count(*) FROM ct_ku WHERE install_id = :i', { i: v1 })).toBe(3);
    expect(rows(c.fx.db, 'SELECT previous_install_id FROM ct_pack_active')).toEqual([{ previous_install_id: v1 }]);
  });

  it('IT-232 job 자식이 적재 도중 강제 종료되면 failed·포인터 불변이고 다음 설치가 failed 행을 정리한다 [FR-CUR-002][CR-12]', async () => {
    // Arrange: v1 활성 + 문항 적재에서 자식을 죽이는 표지
    ctx = await createRealCtx();
    const c = ctx;
    c.put(K8S_V1);
    must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const pointerBefore = rows(c.fx.db, 'SELECT * FROM ct_pack_active');
    const eventsBefore = count(c, 'SELECT count(*) FROM outbox');
    writeFileSync(path.join(c.fx.home.home, 'data', 'crash-on-ingest'), '');
    c.put(K8S_V2);
    // Act
    const view = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    // Assert
    const failed = c.installer.get(view.install_id);
    expect(failed).toMatchObject({
      state: 'failed',
      problem: { code: 'CT-INTERNAL-900', detail: 'pack_load:crashed' },
    });
    expect(rows(c.fx.db, 'SELECT * FROM ct_pack_active')).toEqual(pointerBefore);
    expect(count(c, 'SELECT count(*) FROM outbox')).toBe(eventsBefore);
    expect(rows(c.fx.db, 'SELECT version, state, state_reason FROM ct_pack ORDER BY version')).toEqual([
      { version: '1.0.0', state: 'active', state_reason: null },
      { version: '1.1.0', state: 'failed', state_reason: 'pack_load:crashed' },
    ]);
    const failedInstall = String(
      c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE state = 'failed'").get()?.install_id,
    );
    expect(count(c, 'SELECT count(*) FROM ct_concept_active')).toBe(2); // 조회는 계속 v1
    // 다시 시도: 표지를 지우면 성공하고 failed 행(과 그 설치 범위 행)이 정리된다.
    writeFileSync(path.join(c.fx.home.home, 'data', 'crash-on-ingest'), '');
    const { rmSync } = await import('node:fs'); // boundary-ok: 테스트 정리용 지연 로드
    rmSync(path.join(c.fx.home.home, 'data', 'crash-on-ingest'));
    const retry = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    expect(c.installer.get(retry.install_id)).toMatchObject({ state: 'activated' });
    expect(count(c, 'SELECT count(*) FROM ct_pack WHERE install_id = :i', { i: failedInstall })).toBe(0);
    expect(count(c, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: failedInstall })).toBe(0);
    expect(c.ingestLog().some((l) => l === `purge ${failedInstall}`)).toBe(true);
    expect(count(c, "SELECT count(*) FROM ct_pack WHERE state = 'failed'")).toBe(0);
  });

  it('IT-233 1,250 레코드 job은 배치 3회·진행률 3번을 보고한다 [FR-CUR-002]', async () => {
    // Arrange: 정확히 1,250 레코드(개념 200 + 간선 199 + KU 400 + MC 400 + 기본 3 + 별칭 48)
    ctx = await createRealCtx();
    const c = ctx;
    const aliases = Array.from({ length: 48 }, (_, i) => ({ alias_id: `k8s.legacy-${i}`, target_id: 'k8s.c001' }));
    const staged = stageInstall(c.fx, { concepts: bulkConcepts(200, 2, 2), aliases });
    expect(staged.fpack.records).toHaveLength(1250);
    const progress: { pct: number | null; step: string }[] = [];
    // Act: 실제 job 자식을 직접 실행
    const res = await c.runner.run(
      'pack-load',
      {
        home: c.fx.home.home,
        install_id: staged.installId,
        fpack_path: staged.file,
        expected_sha256: staged.fpack.source_sha256,
      },
      { timeoutMs: 120_000, onProgress: (p) => progress.push(p) },
    );
    // Assert
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toMatchObject({ install_id: staged.installId, batches: 3, overlay_events: 0 });
      expect(res.value.records).toMatchObject({ concept: 200, edge: 199, ku: 400, misconception: 400, alias: 48 });
    }
    expect(progress).toEqual([
      { pct: 40, step: 'load' },
      { pct: 80, step: 'load' },
      { pct: 100, step: 'load' },
    ]);
    expect(rows(c.fx.db, 'SELECT state FROM ct_pack WHERE install_id = :i', { i: staged.installId })).toEqual([
      { state: 'ready' },
    ]);
  });

  it('IT-234 검증 후 파일을 교체하면 source_changed로 실패하고 포인터는 그대로다 [FR-SET-014][CR-12]', async () => {
    // Arrange: 검증 시점 파일을 job 시작 직전에 다른(유효한) 팩으로 바꾼다.
    let swap: (() => void) | null = null;
    ctx = await createRealCtx(
      (real): JobRunner => ({
        run: (name, args, opts) => {
          swap?.();
          return real.run(name, args, opts);
        },
        cancel: () => real.cancel(),
        isBusy: () => real.isBusy(),
        shutdown: () => real.shutdown(),
      }),
    );
    const c = ctx;
    const file = c.put({ ...K8S_V1, concepts: [{ slug: 'pod' }] });
    const other = buildFpack({ ...K8S_V1, concepts: [{ slug: 'pod', rev: 9 }, { slug: 'extra' }] }).bytes;
    swap = () => writeFileSync(file, other);
    // Act
    const view = must(c.installer.install(c.req({ kind: 'file', path: file })));
    await c.installer.idle();
    // Assert
    expect(c.installer.get(view.install_id)).toMatchObject({
      state: 'failed',
      problem: { detail: 'pack_load:source_changed' },
    });
    expect(rows(c.fx.db, 'SELECT state, state_reason FROM ct_pack')).toEqual([
      { state: 'failed', state_reason: 'pack_load:source_changed' },
    ]);
    expect(count(c, 'SELECT count(*) FROM ct_pack_active')).toBe(0);
    expect(count(c, 'SELECT count(*) FROM ct_concept')).toBe(0);
    expect(count(c, 'SELECT count(*) FROM outbox')).toBe(0);
  });

  it('IT-235 진행 중 재요청은 CT-CONFLICT-013, 같은 job 슬롯을 쓰는 다른 installer는 CT-DEP-002다 [FR-CUR-002][CR-12]', async () => {
    // Arrange
    ctx = await createRealCtx();
    const c = ctx;
    c.put(K8S_V1);
    const first = must(c.installer.install(c.req(BUNDLED)));
    // Act / Assert: 같은 installer의 두 번째 요청
    expect(rejected(c.installer.install(c.req(BUNDLED)))).toMatchObject({ code: 'CT-CONFLICT-013', status: 409 });
    // 다른 installer(같은 JobRunner)는 job 슬롯이 차 있어 503
    const other = createPackInstaller({
      db: c.fx.db,
      outbox: c.fx.outbox,
      jobs: c.runner,
      clock: c.fx.clock,
      newId: c.fx.newId,
      log: c.log.logger,
      home: c.fx.home.home,
      packsDir: c.packsDir,
      ingest: { handlers: [] },
    });
    expect(c.runner.isBusy()).toBe(true);
    expect(rejected(other.install(c.req(BUNDLED)))).toMatchObject({ code: 'CT-DEP-002', status: 503 });
    await c.installer.idle();
    expect(c.installer.get(first.install_id)).toMatchObject({ state: 'activated' });
    // 끝난 뒤에는 같은 버전 재요청이 noop이다.
    expect(must(c.installer.install(c.req(BUNDLED)))).toMatchObject({ state: 'activated' });
  });

  it('IT-236 기동 복구 — loading·ready로 남은 설치는 failed(interrupted)가 되고 이후 설치가 정상 진행된다 [FR-SET-014][CR-12]', async () => {
    // Arrange: 이전 프로세스가 죽으면서 남긴 loading·ready 행
    ctx = await createRealCtx();
    const c = ctx;
    const loading = stageInstall(c.fx, { ...K8S_V1, track: 'db', concepts: [{ slug: 'index' }] });
    const ready = stageInstall(c.fx, { ...K8S_V1, track: 'net', concepts: [{ slug: 'tcp' }] });
    c.fx.db.prepare("UPDATE ct_pack SET state = 'ready' WHERE install_id = :i").run({ i: ready.installId });
    // Act: 새 프로세스의 installer가 기동 시 1회 복구
    const fresh = createPackInstaller({
      db: c.fx.db,
      outbox: c.fx.outbox,
      jobs: c.runner,
      clock: c.fx.clock,
      newId: c.fx.newId,
      log: c.log.logger,
      home: c.fx.home.home,
      packsDir: c.packsDir,
      ingest: { handlers: [c.handler] },
    });
    expect(fresh.recoverInterrupted()).toBe(2);
    // Assert
    expect(rows(c.fx.db, 'SELECT pack_id, state, state_reason FROM ct_pack ORDER BY pack_id')).toEqual([
      { pack_id: 'db', state: 'failed', state_reason: 'interrupted' },
      { pack_id: 'net', state: 'failed', state_reason: 'interrupted' },
    ]);
    expect(fresh.get(loading.requestId)).toMatchObject({ state: 'failed', problem: { detail: 'interrupted' } });
    c.put({ track: 'db', version: '1.0.0', concepts: [{ slug: 'index' }] });
    const view = must(fresh.install(c.req({ kind: 'bundled', track: 'db' })));
    await fresh.idle();
    expect(fresh.get(view.install_id)).toMatchObject({ state: 'activated' });
    expect(count(c, "SELECT count(*) FROM ct_pack WHERE pack_id = 'db' AND state = 'failed'")).toBe(0); // 정리됨
  });

  it('IT-237 v1 → v2 후 since = v1의 catalog 버전 export는 변경된 개념만 낸다 [FR-CUR-001][CR-41]', async () => {
    // Arrange
    ctx = await createRealCtx();
    const c = ctx;
    c.put(K8S_V1);
    must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const v1Version = Number(
      c.fx.db
        .prepare("SELECT json_extract(ext, '$.\"catalog.version\"') AS v FROM ct_pack WHERE state = 'active'")
        .get()?.v,
    );
    c.put(K8S_V2); // pod 개정 + ingress 신규, service 불변
    must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    // Act
    const out = [...exportCurriculum(c.fx.db, { since: v1Version }, c.fx.clock)].map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    // Assert
    expect(out[0]).toMatchObject({ kind: 'header', full: false, version: v1Version + 1 });
    const ids = out.flatMap((o) => (o.kind === 'concept' ? [(o.concept as { concept_id: string }).concept_id] : []));
    expect(ids).toEqual(['k8s.ingress', 'k8s.pod']);
    expect(out.at(-1)).toMatchObject({ kind: 'end', count: 3 });
    const full = [...exportCurriculum(c.fx.db, {}, c.fx.clock)];
    expect(full).toHaveLength(1 + 3 + 1);
  });

  it('IT-238 300 개념·3,000 레코드 팩 적재·활성화 tx 소요를 실측한다 (활성화 ≤ 100ms 목표) [FR-CUR-002][CR-12]', async () => {
    // Arrange
    ctx = await createRealCtx();
    const c = ctx;
    c.put({ concepts: bulkConcepts(300, 5, 3) });
    // Act
    const t0 = performance.now();
    const view = must(c.installer.install(c.req(BUNDLED)));
    await c.installer.idle();
    const totalMs = performance.now() - t0;
    // Assert
    expect(c.installer.get(view.install_id)).toMatchObject({ state: 'activated' });
    expect(count(c, 'SELECT count(*) FROM ct_concept_active')).toBe(300);
    expect(count(c, 'SELECT count(*) FROM ct_ku_active')).toBe(1500);
    expect(count(c, 'SELECT count(*) FROM ct_misconception_active')).toBe(900);
    // tx 목록 = [설치 행 생성, …, 활성화]. 서빙 프로세스 tx ≤ 100ms 목표(실측은 보고서 notes에 기록).
    // (가운데 짧은 항목은 기록용 핸들러의 '활성화 tx 안인가' 탐침이다.)
    expect(c.txMs.length).toBeGreaterThanOrEqual(2);
    const insertMs = c.txMs[0] as number;
    const activateMs = c.txMs.at(-1) as number;
    process.stdout.write(
      `IT-238 measured: records=3002 total_ms=${totalMs.toFixed(0)} insert_tx_ms=${insertMs.toFixed(1)} activate_tx_ms=${activateMs.toFixed(1)}\n`,
    );
    expect(insertMs).toBeLessThan(1000);
    expect(activateMs).toBeLessThan(1000); // 목표 100ms — 느린 CI에서도 흔들리지 않게 상한은 넓게 둔다
  });
});
