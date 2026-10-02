import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markInstallFailed } from '../../../src/application/catalog/ingest/install-rows.js';
import { PACK_LOAD_BATCH, runPackLoad } from '../../../src/application/catalog/ingest/pack-load-run.js';
import type { IngestRegistry } from '../../../src/application/catalog/ports.js';
import type { Fixture } from './support/db.js';
import { createFixture, recordingHandler, rows, scalar } from './support/db.js';
import type { PackSpec } from './support/fpack-writer.js';
import { bulkConcepts, gateResultRecord, itemRecord, merkleOf } from './support/fpack-writer.js';
import { loadContext, stageInstall, withExtraItems } from './support/stage.js';

let fx: Fixture;
beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => {
  fx.close();
});

const registry = (...handlers: ReturnType<typeof recordingHandler>[]): IngestRegistry => ({ handlers });
const SMALL: PackSpec = {
  concepts: [
    { slug: 'pod', level: 1, kus: 2, mcs: 1 },
    { slug: 'service', level: 2, prereqs: ['pod'], kus: 1 },
  ],
  aliases: [{ alias_id: 'k8s.pods', target_id: 'k8s.pod' }],
};

function run(staged: ReturnType<typeof stageInstall>, ingest: IngestRegistry, db: SqlitePort = fx.db) {
  const log = loadContext();
  const result = runPackLoad(
    db,
    { ingest, clock: fx.clock },
    { install_id: staged.installId, fpack_path: staged.file, expected_sha256: staged.fpack.source_sha256 },
    log.ctx,
  );
  return { result, log };
}

const stateOf = (installId: string): unknown =>
  fx.db.prepare('SELECT state FROM ct_pack WHERE install_id = :i').get({ i: installId })?.state;

describe('job pack-load 핵심 runPackLoad', () => {
  it('UT-CT-034 kind별 행 매핑 — JSON 열·kind 열·ext·ext_v·0/1 [FR-CUR-002][FR-CUR-009]', () => {
    // Arrange
    const staged = stageInstall(fx, SMALL);
    // Act
    const { result } = run(staged, registry());
    // Assert: 결과 요약
    expect(result).toMatchObject({
      install_id: staged.installId,
      batches: 1,
      overlay_events: 0,
      records: { alias: 1, concept: 2, edge: 1, ku: 3, misconception: 1, rubric: 1, source: 1, track: 1 },
    });
    expect(stateOf(staged.installId)).toBe('ready');
    expect(fx.db.prepare('SELECT ready_at FROM ct_pack WHERE install_id = :i').get({ i: staged.installId })).toEqual({
      ready_at: fx.clock.now(),
    });
    const bind = { i: staged.installId };
    // 트랙
    expect(rows(fx.db, 'SELECT * FROM ct_track WHERE install_id = :i', bind)).toMatchObject([
      {
        track_id: 'k8s',
        name_ko: '트랙 k8s',
        track_group: 'infra',
        sort_order: 10,
        offline_cap_level: 2,
        oracle_cap_level: 3,
        ext: '{}',
        ext_v: 1,
      },
    ]);
    // 출처: source_type → kind 열
    expect(rows(fx.db, 'SELECT * FROM ct_source WHERE install_id = :i', bind)).toMatchObject([
      { source_id: 'src.k8s-docs', kind: 'doc', license_grade: 'A', fetched_at: null, ref_text: null, ext_v: 1 },
    ]);
    // 루브릭: dims → dims_json
    const rubric = rows(fx.db, 'SELECT * FROM ct_rubric WHERE install_id = :i', bind)[0] as { dims_json: string };
    expect(JSON.parse(rubric.dims_json)).toEqual({
      dims: { d_main: { name: '주 차원', weight: 1, levels: { l1: '미흡', l3: '충분' } } },
    });
    expect(rubric.dims_json).toBe(canonicalJson(JSON.parse(rubric.dims_json)));
    // 개념: aliases/tags/diagrams/sources → *_json
    const pod = rows(
      fx.db,
      "SELECT * FROM ct_concept WHERE install_id = :i AND concept_id = 'k8s.pod'",
      bind,
    )[0] as Record<string, unknown>;
    expect(pod).toMatchObject({
      track_id: 'k8s',
      level: 1,
      knowledge_type: 'C',
      tier: 'A',
      aliases_json: '["별칭-pod"]',
      tags_json: '["stack:k8s"]',
      diagrams_json: '{}',
      sources_json: '[]',
      volatility: 'stable',
      required_for_level: null,
      deprecated_by: null,
      ext: '{}',
      ext_v: 1,
    });
    expect(String(pod.content_hash)).toHaveLength(64);
    // 간선: edge_kind → kind 열
    expect(
      rows(
        fx.db,
        'SELECT from_concept_id, to_concept_id, kind, weight FROM ct_concept_edge WHERE install_id = :i',
        bind,
      ),
    ).toEqual([{ from_concept_id: 'k8s.pod', to_concept_id: 'k8s.service', kind: 'prereq', weight: 1 }]);
    expect(rows(fx.db, 'SELECT entity_kind, alias_id, target_id FROM ct_id_alias WHERE install_id = :i', bind)).toEqual(
      [{ entity_kind: 'concept', alias_id: 'k8s.pods', target_id: 'k8s.pod' }],
    );
    // KU: source_refs → source_refs_json
    const ku = rows(fx.db, "SELECT * FROM ct_ku WHERE install_id = :i AND ku_id = 'k8s.pod.k01'", bind)[0] as Record<
      string,
      unknown
    >;
    expect(JSON.parse(String(ku.source_refs_json))).toMatchObject([
      { source_id: 'src.k8s-docs', usage: 'link_only', product_version: null, quote: null },
    ]);
    expect(ku).toMatchObject({
      trust: 'authored',
      origin: 'authored',
      status: 'published',
      valid_as_of: '2026-09-01',
      deprecated_by: null,
    });
    // 오개념: related_ku_ids → related_ku_ids_json
    expect(
      rows(
        fx.db,
        'SELECT mc_id, meta_family, related_ku_ids_json, status FROM ct_misconception WHERE install_id = :i',
        bind,
      ),
    ).toEqual([
      { mc_id: 'k8s.pod.m01', meta_family: 'mf_overgeneral', related_ku_ids_json: '["k8s.pod.k01"]', status: 'active' },
    ]);
  });

  it('UT-CT-035 500건 배치 경계 — 1,250건은 tx 3회, 핸들러 순서·IngestContext·progress [FR-CUR-002]', () => {
    // Arrange: 정확히 1,250 레코드(문항 248개는 핸들러 몫)
    const spec = withExtraItems({ concepts: bulkConcepts(200, 2, 1) }, 248);
    const staged = stageInstall(fx, spec);
    expect(staged.fpack.records).toHaveLength(1250);
    let txCalls = 0;
    const counting: SqlitePort = {
      path: fx.db.path,
      readOnly: fx.db.readOnly,
      prepare: (sql) => fx.db.prepare(sql),
      exec: (sql) => fx.db.exec(sql),
      fn: (name, impl, o) => fx.db.fn(name, impl, o),
      close: () => undefined,
      tx: (fn) => {
        txCalls += 1;
        return fx.db.tx(fn);
      },
    };
    const handler = recordingHandler(['item']);
    // Act
    const { result, log } = run(staged, registry(handler), counting);
    // Assert
    expect(PACK_LOAD_BATCH).toBe(500);
    expect(result.batches).toBe(3);
    expect(txCalls).toBe(3 + 2); // 대상 확인 1 + 배치 3 + ready 전환 1
    expect(log.calls).toEqual([
      { pct: 40, step: 'load' },
      { pct: 80, step: 'load' },
      { pct: 100, step: 'load' },
    ]);
    // 문항 레코드는 번들 순서(1,003번째부터) → 세 번째 배치에서만 한 번에 묶여 호출된다.
    expect(handler.ingestCalls).toHaveLength(1);
    const call = handler.ingestCalls[0];
    expect(call?.kinds.every((k) => k === 'item')).toBe(true);
    expect(call?.ids).toEqual(Array.from({ length: 248 }, (_, i) => `k8s.c001.i${String(i + 1).padStart(2, '0')}`));
    expect(call?.ctx).toEqual({
      install_id: staged.installId,
      pack_id: 'k8s',
      pack_version: '1.0.0',
      loaded_at: fx.clock.now(),
    });
    expect(result.records).toMatchObject({ concept: 200, ku: 400, misconception: 200, item: 248, edge: 199 });
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: staged.installId })).toBe(200);
  });

  it('UT-CT-035 한 배치에서 핸들러가 던지면 그 배치 행은 롤백되고 설치는 loading으로 남는다 [FR-CUR-002]', () => {
    // Arrange: 개념 200개 → 배치 1은 성공, 문항이 든 배치 3에서 예외
    const staged = stageInstall(fx, withExtraItems({ concepts: bulkConcepts(200, 2, 1) }, 248));
    const handler = recordingHandler(['item']);
    Object.assign(handler, {
      ingest: (): void => {
        throw new Error('boom');
      },
    });
    // Act / Assert
    expect(() => run(staged, registry(handler))).toThrow('boom');
    expect(stateOf(staged.installId)).toBe('loading');
    // 앞 두 배치(1~1,000번째 레코드)는 커밋돼 있고, 실패한 세 번째 배치(마지막 MC 2건 포함)는 통째로 롤백된다.
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_misconception WHERE install_id = :i', { i: staged.installId })).toBe(
      198,
    );
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: staged.installId })).toBe(200);
  });

  it('UT-CT-036 번들에 8종도 등록 핸들러 kind도 아닌 레코드가 있으면 첫 INSERT 전에 실패하고 ready가 되지 않는다 [FR-CUR-002]', () => {
    // Arrange: 핸들러가 없는데 문항이 있다
    const staged = stageInstall(fx, { concepts: [{ slug: 'pod', items: 1 }] });
    // Act / Assert
    expect(() => run(staged, registry())).toThrow('unsupported_record_kind:item');
    expect(stateOf(staged.installId)).toBe('loading');
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: staged.installId })).toBe(0);
    // 핸들러가 item만 선언했는데 gate_result가 있으면 그 kind로 실패한다.
    const item = itemRecord('k8s', 'pod', 1);
    const staged2 = stageInstall(fx, {
      version: '1.0.1',
      concepts: [{ slug: 'pod', items: 1 }],
      extra_records: [gateResultRecord(String(item.item_id), String(item.content_hash))],
    });
    expect(() => run(staged2, registry(recordingHandler(['item'])))).toThrow('unsupported_record_kind:gate_result');
    expect(stateOf(staged2.installId)).toBe('loading');
  });

  it('UT-CT-037 failed 설치는 다음 적재에서 purge 호출 + CASCADE로 정리되고 다른 팩의 failed는 건드리지 않는다 [FR-CUR-002][FR-CUR-009]', () => {
    // Arrange: k8s 1.0.0을 적재한 뒤 failed로 돌리고, 다른 팩 db의 failed도 하나 둔다.
    const handler = recordingHandler();
    const first = stageInstall(fx, SMALL);
    run(first, registry(handler));
    expect(markInstallFailed(fx.db, first.installId, 'pack_load:test', fx.newId(), fx.clock.now())).toBe(true);
    const other = stageInstall(fx, { track: 'db', concepts: [{ slug: 'index' }] });
    run(other, registry(handler));
    expect(markInstallFailed(fx.db, other.installId, 'pack_load:test', fx.newId(), fx.clock.now())).toBe(true);
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: first.installId })).toBe(2);
    // Act: 같은 팩의 다음 설치
    const second = stageInstall(fx, { ...SMALL, version: '1.1.0' });
    run(second, registry(handler));
    // Assert
    expect(handler.purged).toEqual([first.installId]);
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_pack WHERE install_id = :i', { i: first.installId })).toBe(0);
    for (const table of [
      'ct_concept',
      'ct_ku',
      'ct_misconception',
      'ct_concept_edge',
      'ct_track',
      'ct_source',
      'ct_rubric',
      'ct_id_alias',
    ]) {
      expect(scalar(fx.db, `SELECT count(*) FROM ${table} WHERE install_id = :i`, { i: first.installId }), table).toBe(
        0,
      ); // sql-ok: 고정 목록 테이블명
    }
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_pack WHERE install_id = :i', { i: other.installId })).toBe(1);
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: other.installId })).toBe(1);
    expect(stateOf(second.installId)).toBe('ready');
  });

  it('UT-CT-038 적용된 PackDelta가 있으면 delta_reapply_unsupported, overlay 수는 결과로 보고한다 [FR-CUR-002][FR-CUR-009]', () => {
    // Arrange: 오버레이 이벤트 2건 — 적재에는 영향이 없고 수만 보고
    for (let n = 0; n < 2; n += 1) {
      fx.db
        .prepare(
          `INSERT INTO ct_overlay_event(overlay_id, target_kind, target_id, field, base_version, new_value, reason, device_id, ts, recorded_at)
VALUES (:id, 'concept', 'k8s.pod', 'summary_ko', 'v', '"x"', 'test', :dev, 1, 1)`,
        )
        .run({ id: fx.newId(), dev: fx.newId() });
    }
    const ok = stageInstall(fx, SMALL);
    expect(run(ok, registry()).result.overlay_events).toBe(2);
    // 같은 팩에 적용된 delta가 있으면 새 설치 위에 되살릴 수 없다(IT-04 수입 WP 전).
    fx.db
      .prepare(
        `INSERT INTO ct_pack_delta(delta_id, pack_id, origin, ops_json, base_install_id, applied_install_id, status, created_at, applied_at)
VALUES (:id, 'k8s', 'import', '[]', :base, :base, 'applied', 1, 1)`,
      )
      .run({ id: fx.newId(), base: ok.installId });
    const next = stageInstall(fx, { ...SMALL, version: '1.1.0' });
    expect(() => run(next, registry())).toThrow('delta_reapply_unsupported');
    expect(stateOf(next.installId)).toBe('loading');
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_concept WHERE install_id = :i', { i: next.installId })).toBe(0);
    // conflicted·rejected delta는 막지 않는다.
    fx.db.prepare("UPDATE ct_pack_delta SET status = 'conflicted'").run();
    expect(run(next, registry()).result.batches).toBe(1);
  });

  it('UT-CT-039 두 핸들러가 같은 kind를 선언하면 job 시작 시 invariant로 던지고 아무것도 바꾸지 않는다 [FR-CUR-002]', () => {
    const staged = stageInstall(fx, SMALL);
    expect(() => run(staged, registry(recordingHandler(['item']), recordingHandler(['item', 'gate_result'])))).toThrow(
      /invariant: ingest kind item declared by more than one handler/,
    );
    expect(stateOf(staged.installId)).toBe('loading');
    expect(scalar(fx.db, 'SELECT count(*) FROM ct_track WHERE install_id = :i', { i: staged.installId })).toBe(0);
  });

  it('UT-CT-034 loading이 아닌 설치·파일 교체·번들 중복은 코드화된 오류로 실패한다 [FR-CUR-002]', () => {
    const done = stageInstall(fx, SMALL);
    run(done, registry());
    expect(() => run(done, registry())).toThrow('install_state_invalid'); // 이미 ready
    // 검증 후 파일이 바뀐 경우 = 기대 해시와 다름
    const swapped = stageInstall(fx, { ...SMALL, version: '1.2.0' });
    const log = loadContext();
    expect(() =>
      runPackLoad(
        fx.db,
        { ingest: registry(), clock: fx.clock },
        { install_id: swapped.installId, fpack_path: swapped.file, expected_sha256: 'f'.repeat(64) },
        log.ctx,
      ),
    ).toThrow('source_changed');
    // 번들에 같은 개념이 두 번 → 제약 위반(조용히 덮어쓰지 않는다)
    const dup = stageInstall(
      fx,
      { version: '1.3.0', concepts: [{ slug: 'pod' }] },
      {
        parts: (p) => {
          const at = p.lines.findIndex((l) => l.includes('"kind":"concept"'));
          p.lines.splice(at, 0, p.lines[at] as string);
          (p.manifest.counts as { concepts: number }).concepts = 2;
          p.manifest.merkle_root = merkleOf(p.lines);
        },
      },
    );
    expect(() => run(dup, registry())).toThrow(/constraint|UNIQUE/i);
    expect(stateOf(dup.installId)).toBe('loading');
  });
});
