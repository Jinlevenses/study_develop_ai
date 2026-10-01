import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  G01Input,
  G02Input,
  G03Input,
  G04Input,
  G05Input,
  G06Input,
  G07Input,
  G08Input,
  G09Input,
  G11Input,
  G12Input,
  G13Input,
  GENERATE_INPUTS,
  GenerateJobPayload,
  GenerateRequest,
  GenerateResult,
  GenerateUnavailableReason,
} from '../../../src/ai/generate.js';
import { assertPortable, PORTABLE_SCHEMAS, toPortableJsonSchema } from '../../../src/ai/portable-schema.js';
import { GenerateTaskId } from '../../../src/ai/tasks.js';
import { contextRef, generateJobPayload, ULID, ULID_B } from './samples.js';

const genRequest = {
  lane: 'interactive',
  input: { any: 'thing' },
  blocks: [{ key: 'kus', text: '본문', data_class: 'C0', untrusted: false, source_ref: null }],
  context_ref: contextRef,
  stream: false,
  deadline_ms: 20_000,
  family_exclude: [],
  local_only: false,
};
const genOk = {
  status: 'ok',
  output: { summary_md: '요약' },
  schema_id: 'ai/Feedback@1',
  provider_id: 'anthropic-api',
  model: 'claude-haiku',
  prompt_version: '1.0.0',
  repaired: false,
  cache_hit: false,
  call_id: ULID,
  firewall_decision_id: ULID_B,
  cost: { basis: 'reported', krw: 12, usd: 0.01 },
  latency_ms: 800,
};

describe('ai/generate.ts', () => {
  it('UT-CON-137 GenerateRequest·GenerateResult 3 status · GENERATE_INPUTS 키 12개(AI-G10 없음) [FR-AI-006]', () => {
    expect(GenerateRequest.safeParse(genRequest).success).toBe(true);
    expect(GenerateRequest.safeParse({ ...genRequest, lane: 'background' }).success).toBe(false); // background는 IF-AI-010
    expect(GenerateRequest.safeParse({ ...genRequest, deadline_ms: 120_001 }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...genRequest, deadline_ms: 99 }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...genRequest, blocks: Array(65).fill(genRequest.blocks[0]) }).success).toBe(
      false,
    );
    expect(GenerateRequest.safeParse({ ...genRequest, extra: 1 }).success).toBe(false);

    const streaming = {
      status: 'streaming',
      stream_ref: ULID,
      expires_at: 5,
      provider_id: 'ollama',
      prompt_version: '1.0.0',
      call_id: ULID_B,
    };
    const unavailable = { status: 'unavailable', reason: 'schema_violation', retry_after_ms: null };
    expect(GenerateResult.options).toHaveLength(3);
    for (const r of [genOk, streaming, unavailable]) {
      expect(GenerateResult.safeParse(r).success, r.status).toBe(true);
    }
    expect(GenerateResult.safeParse({ ...genOk, schema_id: 'ItemBatch' }).success).toBe(false);
    expect(GenerateResult.safeParse({ ...genOk, cost: { basis: 'guess', krw: 1, usd: null } }).success).toBe(false);
    expect(GenerateResult.safeParse({ ...streaming, provider_id: 'jev' }).success).toBe(true);
    expect(GenerateResult.safeParse({ ...unavailable, reason: 'calibrated_engine_unavailable' }).success).toBe(false); // 판정 전용 사유
    expect(GenerateUnavailableReason.options).toHaveLength(13);
    expect(GenerateJobPayload.safeParse(generateJobPayload).success).toBe(true);

    const keys = Object.keys(GENERATE_INPUTS);
    expect(keys).toHaveLength(12);
    expect(keys).not.toContain('AI-G10'); // AI-G10 = 내부 repair, 입력 스키마 없음
    expect(keys).toEqual(GenerateTaskId.options.filter((t) => t !== 'AI-G10'));
    for (const schema of Object.values(GENERATE_INPUTS)) {
      expect(schema.safeParse({ unknown: 1 }).success).toBe(false);
    }
    expect(GENERATE_INPUTS['AI-G07']).toBe(G07Input);
    expect(GENERATE_INPUTS['AI-G01']).toBe(G01Input);
  });

  it('UT-CON-138 G01~G13 입력 각 1건 통과, G07Input.constraints.no_answer false 거부 [FR-AI-020]', () => {
    const samples = {
      G01: [
        G01Input,
        {
          blueprint: {
            format: 'mcq',
            level: 2,
            bloom: 'apply',
            count: 3,
            target_ku_ids: ['k8s.probes.k01'],
            forbidden: [],
          },
          recent_items_digest: [],
        },
      ],
      G02: [G02Input, { track: 'k8s', level: 4, scenario_kind: 'incident', target_ku_ids: [] }],
      G03: [G03Input, { lab_spec_md: '과제', lang: 'ts', complexity_target: null }],
      G04: [G04Input, { item_id: 'k8s.probes.i01', missing: ['explanation'] }],
      G05: [G05Input, { chunk_keys: ['ch01'], target_track: null }],
      G06: [G06Input, { verdict_id: ULID, units: { u01: { status: 'partial', ku_id: null } } }],
      G07: [
        G07Input,
        {
          move: 'probe_why',
          target_ku_id: null,
          target_mc_id: null,
          constraints: { max_sentences: 3, single_question: true, no_answer: true },
        },
      ],
      G08: [G08Input, { concept_id: 'k8s.probes', level: 2 }],
      G09: [G09Input, { item_id: 'k8s.probes.i01', count: 3 }],
      G11: [G11Input, { item_id: 'k8s.probes.i01' }],
      G12: [G12Input, { target: { kind: 'concept', concept_id: 'k8s.probes' }, output_kind: 'model_answer' }],
      G13: [G13Input, { concept_id: 'k8s.probes', artifact_kind: null }],
    } as const;
    expect(Object.keys(samples)).toHaveLength(12);
    for (const [name, [schema, sample]] of Object.entries(samples)) {
      expect(schema.safeParse(sample).success, name).toBe(true);
      expect(schema.safeParse({ ...sample, extra: 1 }).success, `${name}+extra`).toBe(false);
    }
    const g07 = samples.G07[1];
    for (const bad of [{ no_answer: false }, { single_question: false }, { max_sentences: 4 }]) {
      expect(
        G07Input.safeParse({ ...g07, constraints: { ...g07.constraints, ...bad } }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect(
      G01Input.safeParse({ ...samples.G01[1], blueprint: { ...samples.G01[1].blueprint, count: 6 } }).success,
    ).toBe(false);
    expect(G04Input.safeParse({ item_id: 'k8s.probes.i01', missing: [] }).success).toBe(false);
    expect(G09Input.safeParse({ item_id: 'k8s.probes.i01', count: 0 }).success).toBe(false);
    expect(G12Input.safeParse({ target: { kind: 'item' }, output_kind: 'model_answer' }).success).toBe(false);
  });
});

describe('ai/portable-schema.ts', () => {
  it('UT-CON-139 PORTABLE_SCHEMAS 12키, 각각 assertPortable(toPortableJsonSchema(s)) throw 0 [FR-AI-006]', () => {
    const keys = Object.keys(PORTABLE_SCHEMAS);
    expect(keys).toHaveLength(12);
    expect(keys).toEqual([
      'ai/ItemBatch@1',
      'ai/ScenarioItem@1',
      'ai/CodeExercise@1',
      'ai/Explanation@1',
      'ai/ImportDraft@1',
      'ai/Feedback@1',
      'ai/Utterance@1',
      'ai/ItemVariant@1',
      'ai/IndependentSolve@1',
      'ai/ModelAnswer@1',
      'ai/Rubric@1',
      'ai/LlmJudgeAnswers@1',
    ]);
    for (const [id, schema] of Object.entries(PORTABLE_SCHEMAS)) {
      const json = toPortableJsonSchema(schema);
      expect(() => assertPortable(json), id).not.toThrow();
      expect(json.$schema, id).toBeUndefined();
    }
    // 규칙 ③: pattern·format 키워드는 삭제되지만 같은 이름의 속성은 남는다(ItemBatch.items[].format)
    const batch = JSON.stringify(toPortableJsonSchema(PORTABLE_SCHEMAS['ai/ItemBatch@1']));
    expect(batch).not.toContain('"pattern"');
    expect(batch).toContain('"format":{');
    // 원본 z.toJSONSchema에는 pattern이 있다(ObjKey) — 변환이 실제로 일을 한다
    expect(JSON.stringify(z.toJSONSchema(PORTABLE_SCHEMAS['ai/ItemBatch@1']))).toContain('"pattern"');
    expect(() => assertPortable(z.toJSONSchema(PORTABLE_SCHEMAS['ai/ItemBatch@1']))).toThrow('non-portable');
    // 변환은 순수하다(같은 입력 = 같은 출력)
    expect(toPortableJsonSchema(PORTABLE_SCHEMAS['ai/Rubric@1'])).toEqual(
      toPortableJsonSchema(PORTABLE_SCHEMAS['ai/Rubric@1']),
    );
  });

  it('UT-CON-140 assertPortable 음성 6종(record·oneOf·깊이 6·additionalProperties 누락·optional 속성·format) 각각 throw [FR-AI-006]', () => {
    const str = { type: 'string' };
    const obj = (properties: Record<string, unknown>) => ({
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    });
    // 양성 기준선: 깊이 5(루트 = 1)까지 통과
    const depth = (n: number): Record<string, unknown> => (n === 1 ? obj({ a: str }) : obj({ a: depth(n - 1) }));
    expect(() => assertPortable(depth(5))).not.toThrow();
    expect(() => assertPortable(obj({ a: { type: 'array', items: obj({ b: str }), maxItems: 3 } }))).not.toThrow();
    expect(() =>
      assertPortable(obj({ a: { anyOf: [{ type: 'string', maxLength: 10 }, { type: 'null' }] } })),
    ).not.toThrow();

    const negatives: Record<string, unknown> = {
      record: toPortableJsonSchema(z.object({ a: z.record(z.string(), z.string()) }).strict()),
      oneOf: obj({ a: { oneOf: [{ type: 'string' }, { type: 'number' }] } }),
      depth6: depth(6),
      noAdditionalProperties: { type: 'object', properties: { a: str }, required: ['a'] },
      optional: toPortableJsonSchema(z.object({ a: z.string(), b: z.string().optional() }).strict()),
      format: obj({ a: { type: 'string', format: 'email' } }),
    };
    expect(Object.keys(negatives)).toHaveLength(6);
    for (const [name, json] of Object.entries(negatives)) {
      expect(() => assertPortable(json), name).toThrow(/^non-portable: /);
    }
    // 위반 메시지에 규칙 이름이 담긴다
    expect(() => assertPortable(negatives.oneOf)).toThrow('forbidden keyword oneOf');
    expect(() => assertPortable(negatives.depth6)).toThrow('depth 6 > 5');
    expect(() => assertPortable(negatives.noAdditionalProperties)).toThrow('additionalProperties must be false');
    expect(() => assertPortable(negatives.optional)).toThrow('required must list every property');
    expect(() => assertPortable(negatives.format)).toThrow('forbidden keyword format');
    // 그 밖의 위반: anyOf는 [T, null]만, $ref·허용 목록 밖 키워드 금지
    expect(() => assertPortable(obj({ a: { anyOf: [str, { type: 'number' }] } }))).toThrow('anyOf must be [T, null]');
    expect(() => assertPortable(obj({ a: { anyOf: [str, { type: 'number' }, { type: 'null' }] } }))).toThrow(
      'anyOf must be [T, null]',
    );
    expect(() => assertPortable(obj({ a: { $ref: '#/$defs/x' } }))).toThrow('forbidden keyword $ref');
    expect(() => assertPortable(obj({ a: { type: 'string', minLength: 1 } }))).toThrow('keyword minLength not allowed');
    expect(() => assertPortable(obj({ a: { type: 'string', pattern: '^a$' } }))).toThrow('forbidden keyword pattern');
    expect(() => assertPortable(obj({ a: { allOf: [str] } }))).toThrow('forbidden keyword allOf');
  });

  it('UT-CON-141 각 portable JSON Schema minify(JSON.stringify) ≤ 8,192바이트 [FR-AI-006]', () => {
    for (const [id, schema] of Object.entries(PORTABLE_SCHEMAS)) {
      const bytes = new TextEncoder().encode(JSON.stringify(toPortableJsonSchema(schema))).length;
      expect(bytes, id).toBeGreaterThan(0);
      expect(bytes, id).toBeLessThanOrEqual(8192); // D-AI-35
    }
  });
});
