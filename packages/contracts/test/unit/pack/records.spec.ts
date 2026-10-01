import { describe, expect, it } from 'vitest';
import { PackDelta, PackDeltaOp } from '../../../src/pack/delta.js';
import { AssessmentInventory } from '../../../src/pack/feasibility.js';
import { FpackManifest } from '../../../src/pack/manifest.js';
import {
  BundleRecord,
  ConceptRecord,
  GateResultRecord,
  KuRecord,
  PackSourceRef,
  TrackRecord,
} from '../../../src/pack/records.js';
import { inventory, LEVEL_KEYS, MODES, perMode } from './inventory.js';
import { records, SHA, sourceRef, ULID } from './records-samples.js';

const manifest = {
  pack_id: 'k8s',
  track: 'k8s',
  version: '1.0.0',
  channel: 'seed',
  schema_v: 1,
  packc_version: '0.1.0',
  files: [
    { path: 'bundle.jsonl', sha256: SHA, bytes: 100 },
    { path: 'report.json', sha256: SHA, bytes: 10 },
    { path: 'layout.json', sha256: SHA, bytes: 10 },
  ],
  merkle_root: SHA,
  counts: { concepts: 1, kus: 1, misconceptions: 1, items: 1, cases: 0 },
  required_for_level: { 1: 2, 2: 3, 3: 0, 4: 0, 5: 0 },
  offline_cap_level: 3,
  created_at: 1_700_000_000_000,
};

describe('pack/manifest.ts', () => {
  it('UT-CON-120 FpackManifest: files 3개 정확, required_for_level 5키 전수 [FR-CUR-002]', () => {
    expect(FpackManifest.safeParse(manifest).success).toBe(true);
    expect(FpackManifest.safeParse({ ...manifest, files: manifest.files.slice(0, 2) }).success).toBe(false);
    expect(FpackManifest.safeParse({ ...manifest, files: [...manifest.files, manifest.files[0]] }).success).toBe(false);
    expect(
      FpackManifest.safeParse({
        ...manifest,
        files: [{ path: 'other.json', sha256: SHA, bytes: 1 }, ...manifest.files.slice(1)],
      }).success,
    ).toBe(false);
    // zod 4: z.record(z.enum([...]))는 전 키 필수(전수 record)
    expect(FpackManifest.safeParse({ ...manifest, required_for_level: { 1: 2, 2: 3, 3: 0, 4: 0 } }).success).toBe(
      false,
    );
    expect(
      FpackManifest.safeParse({ ...manifest, required_for_level: { ...manifest.required_for_level, 6: 1 } }).success,
    ).toBe(false);
    expect(
      FpackManifest.safeParse({ ...manifest, required_for_level: { ...manifest.required_for_level, 5: -1 } }).success,
    ).toBe(false);
    expect(FpackManifest.safeParse({ ...manifest, channel: 'x' }).success).toBe(false);
    expect(FpackManifest.safeParse({ ...manifest, schema_v: 0 }).success).toBe(false);
    expect(FpackManifest.safeParse({ ...manifest, extra: 1 }).success).toBe(false);
  });
});

describe('pack/records.ts', () => {
  it('UT-CON-121 BundleRecord 판별자 18종(options.length === 18) 각 1건 통과, Ext 키 pack.x 통과·x 거부, KuRecord.origin 3형식, GateResultRecord.run_context 리터럴 [FR-CUR-002][CR-46]', () => {
    expect(BundleRecord.options).toHaveLength(18);
    expect(Object.keys(records)).toHaveLength(18);
    for (const [kind, rec] of Object.entries(records)) {
      expect(BundleRecord.safeParse(rec).success, kind).toBe(true);
      expect(BundleRecord.safeParse({ ...rec, extra_field: 1 }).success, `${kind}+extra`).toBe(false);
    }
    expect(BundleRecord.safeParse({ kind: 'rubricx' }).success).toBe(false);

    // Ext: 키 = 'pack.<field>' (DCP DN-13)
    expect(TrackRecord.safeParse({ ...records.track, ext: { 'pack.license': 'MIT' } }).success).toBe(true);
    expect(TrackRecord.safeParse({ ...records.track, ext: { 'pack.x': { a: [1, null] } } }).success).toBe(true);
    expect(TrackRecord.safeParse({ ...records.track, ext: { x: 1 } }).success).toBe(false);
    expect(TrackRecord.safeParse({ ...records.track, ext: { 'pack.X': 1 } }).success).toBe(false);
    expect(TrackRecord.safeParse({ ...records.track, ext: { 'pack.': 1 } }).success).toBe(false);

    // KuRecord.origin 3형식
    for (const origin of ['authored', `import:${ULID}`, `tier_promotion:${ULID}`]) {
      expect(KuRecord.safeParse({ ...records.ku, origin }).success, origin).toBe(true);
    }
    for (const origin of ['import:abc', 'imported', 'authored:x', '']) {
      expect(KuRecord.safeParse({ ...records.ku, origin }).success, origin).toBe(false);
    }
    expect(KuRecord.safeParse({ ...records.ku, source_refs: [] }).success).toBe(false);
    expect(KuRecord.safeParse({ ...records.ku, statement: '짧다' }).success).toBe(false);

    // GateResultRecord.run_context 리터럴 'seed_build'
    expect(GateResultRecord.safeParse({ ...records.gate_result, run_context: 'runtime' }).success).toBe(false);
    expect(GateResultRecord.safeParse({ ...records.gate_result, gate: 'S2_APPROVAL' }).success).toBe(true);
    expect(GateResultRecord.safeParse({ ...records.gate_result, gate: 'g3' }).success).toBe(false);
    expect(GateResultRecord.safeParse({ ...records.gate_result, engine: 'X' }).success).toBe(false);

    // 레코드 경계 일부(개념·소스 참조)
    expect(ConceptRecord.safeParse({ ...records.concept, title_ko: 'a'.repeat(61) }).success).toBe(false);
    expect(
      ConceptRecord.safeParse({
        ...records.concept,
        diagrams: { flow01: { mermaid: 'x', alt: '짧', summary: '짧다' } },
      }).success,
    ).toBe(false);
    expect(PackSourceRef.safeParse(sourceRef).success).toBe(true);
    expect(PackSourceRef.safeParse({ ...sourceRef, usage: 'copy' }).success).toBe(false);
    expect(PackSourceRef.safeParse({ ...sourceRef, retrieved_at: '2026-13-01' }).success).toBe(false);
  });
});

const op = { op: 'alias', base_version: null, concept_id: 'k8s.probes', alias: '헬스체크' } as const;
const ops = {
  upsert_concept: { op: 'upsert_concept', base_version: SHA, record: records.concept },
  upsert_ku: { op: 'upsert_ku', base_version: null, record: records.ku },
  alias: op,
  deprecate: {
    op: 'deprecate',
    base_version: SHA,
    target_kind: 'ku',
    target_id: 'k8s.probes.k01',
    deprecated_by: null,
  },
  upsert_misconception: { op: 'upsert_misconception', base_version: null, record: records.misconception },
  upsert_item_model: { op: 'upsert_item_model', base_version: null, record: records.item_model },
  publish_items: { op: 'publish_items', base_version: null, records: [records.item] },
  set_gate_status: {
    op: 'set_gate_status',
    base_version: SHA,
    item_id: 'k8s.probes.i01',
    gate_status: 'gated_pass',
    gate_result_id: ULID,
  },
  quarantine_family: {
    op: 'quarantine_family',
    base_version: null,
    stem_family: 'sf_probe',
    prompt_version: null,
    evidence_policy: 'void',
  },
  upsert_case: { op: 'upsert_case', base_version: null, record: records.case },
  upsert_blueprint: { op: 'upsert_blueprint', base_version: null, record: records.blueprint },
  attach_source: {
    op: 'attach_source',
    base_version: null,
    target_kind: 'concept',
    target_id: 'k8s.probes',
    source: records.source,
  },
} as const;
const delta = { delta_id: ULID, pack_id: 'u.local', channel: 'user', source: { kind: 'import', ref: ULID }, ops: [op] };

describe('pack/delta.ts', () => {
  it('UT-CON-122 PackDeltaOp 12종, PackDelta.ops 0·5001개 거부, base_version null 허용 [FR-CUR-020][CR-10]', () => {
    expect(PackDeltaOp.options).toHaveLength(12);
    expect(Object.keys(ops)).toHaveLength(12);
    for (const [name, o] of Object.entries(ops)) {
      expect(PackDeltaOp.safeParse(o).success, name).toBe(true);
      expect(PackDeltaOp.safeParse({ ...o, extra: 1 }).success, `${name}+extra`).toBe(false);
    }
    expect(PackDeltaOp.safeParse({ ...op, base_version: null }).success).toBe(true);
    expect(PackDeltaOp.safeParse({ ...op, base_version: 'short' }).success).toBe(false);
    expect(PackDeltaOp.safeParse({ op: 'drop_everything', base_version: null }).success).toBe(false);
    expect(PackDeltaOp.safeParse({ ...ops.publish_items, records: [] }).success).toBe(false);
    expect(PackDeltaOp.safeParse({ ...ops.deprecate, target_kind: 'case' }).success).toBe(false);

    expect(PackDelta.safeParse(delta).success).toBe(true);
    expect(PackDelta.safeParse({ ...delta, ops: [] }).success).toBe(false);
    expect(PackDelta.safeParse({ ...delta, ops: Array(5000).fill(op) }).success).toBe(true);
    expect(PackDelta.safeParse({ ...delta, ops: Array(5001).fill(op) }).success).toBe(false);
    expect(PackDelta.safeParse({ ...delta, channel: 'seed' }).success).toBe(false); // delta는 local·user 채널만
    expect(PackDelta.safeParse({ ...delta, source: { kind: 'manual', ref: ULID } }).success).toBe(false);
    expect(PackDelta.safeParse({ ...delta, extra: 1 }).success).toBe(false);
  });
});

describe('pack/feasibility.ts AssessmentInventory', () => {
  it('UT-CON-123 AssessmentInventory: formats_by_mode 3모드 거부(전수 record), assessment_pool 5레벨×4모드 [FR-CUR-025]', () => {
    const inv = inventory();
    expect(AssessmentInventory.safeParse(inv).success).toBe(true);
    // 모드 3개만 있는 formats_by_mode는 거부(zod 4 전수 record)
    const { OFFLINE: _o, ...threeModes } = perMode(['mcq']);
    const first = inv.concepts[0];
    expect(first).toBeDefined();
    const bad = { ...inv, concepts: [{ ...first, formats_by_mode: threeModes }] };
    expect(AssessmentInventory.safeParse(bad).success).toBe(false);
    // 풀: 5레벨 × 4모드 전수
    expect(Object.keys(inv.assessment_pool)).toEqual([...LEVEL_KEYS]);
    for (const level of Object.values(inv.assessment_pool)) {
      expect(Object.keys(level)).toEqual([...MODES]);
    }
    const { 5: _l5, ...fourLevels } = inv.assessment_pool;
    expect(AssessmentInventory.safeParse({ ...inv, assessment_pool: fourLevels }).success).toBe(false);
    const { OFFLINE: _x, ...threeInLevel } = inv.assessment_pool['1'] ?? {};
    expect(
      AssessmentInventory.safeParse({ ...inv, assessment_pool: { ...inv.assessment_pool, 1: threeInLevel } }).success,
    ).toBe(false);
    expect(
      AssessmentInventory.safeParse({
        ...inv,
        assessment_pool: { ...inv.assessment_pool, 6: perMode({ items: 1, formats: [] }) },
      }).success,
    ).toBe(false);
    expect(AssessmentInventory.safeParse({ ...inv, track: 'nope' }).success).toBe(false);
    expect(
      AssessmentInventory.safeParse({ ...inv, cases: [{ case_id: 'k8s.case.x-y', level: 4, tracks: ['k8s'] }] })
        .success,
    ).toBe(true);
    expect(
      AssessmentInventory.safeParse({
        ...inv,
        cases: Array(61).fill({ case_id: 'k8s.case.x-y', level: 4, tracks: ['k8s'] }),
      }).success,
    ).toBe(false);
    expect(AssessmentInventory.safeParse({ ...inv, extra: 1 }).success).toBe(false);
  });
});
