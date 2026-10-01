import { describe, expect, it } from 'vitest';
import { AI_GATEWAY_POLICY } from '../../../src/ai/ai-gateway-policy.js';
import { ContextBlock, ContextRef } from '../../../src/ai/data-class.js';
import { keyedFromList } from '../../../src/ai/judge-keys.js';
import { GenerateTaskId, JudgeTaskId, SystemTaskId, TaskId, TaskRegistryEntry } from '../../../src/ai/tasks.js';
import { contextRef } from './samples.js';

const entry = {
  kind: 'judge',
  lane: 'interactive',
  chain: ['jev', 'llm-judge'],
  question_types: ['noul', 'choice'],
  max_questions_per_request: 15,
  schema: 'ai/LlmJudgeAnswers@1',
  tier: 'low',
  prompt: { id: 'AI-J03', channel: 'active' },
  prefer: ['jev'],
  deny: { 'claude-cli': ['AI-J19'] },
  data_class_max: 'C1',
  family_constraint: 'none',
  deadline_ms: 3000,
  requires_work_order: false,
};

describe('ai/tasks.ts · data-class.ts · ai-gateway-policy.ts', () => {
  it('UT-CON-130 JudgeTaskId 19 · GenerateTaskId 13 · TaskId 32 · SystemTaskId 3이 TaskId에 없음 · TaskRegistryEntry 샘플 [FR-AI-004]', () => {
    expect(JudgeTaskId.options).toHaveLength(19);
    expect(GenerateTaskId.options).toHaveLength(13);
    expect(SystemTaskId.options).toEqual(['SYS-CANARY', 'SYS-SMOKE', 'SYS-FWCLS']);
    const all = [...JudgeTaskId.options, ...GenerateTaskId.options];
    expect(new Set(all).size).toBe(32);
    for (const id of all) {
      expect(TaskId.safeParse(id).success, id).toBe(true);
    }
    for (const id of SystemTaskId.options) {
      expect(TaskId.safeParse(id).success, id).toBe(false); // 내부 전용(HTTP 라우팅 불가)
    }
    expect(TaskId.safeParse('AI-J20').success).toBe(false);
    expect(TaskId.safeParse('AI-G14').success).toBe(false);
    expect(GenerateTaskId.options.some((id) => /answer|ghost/i.test(id))).toBe(false); // 정답 대필 과업은 enum에 없다

    expect(TaskRegistryEntry.safeParse(entry).success).toBe(true);
    expect(TaskRegistryEntry.safeParse({ ...entry, chain: [] }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, chain: ['jev', 'llm-judge', 'llm', 'jev'] }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, chain: ['gpt'] }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, max_questions_per_request: 16 }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, schema: 'ItemBatch' }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, deadline_ms: 99 }).success).toBe(false);
    expect(TaskRegistryEntry.safeParse({ ...entry, extra: 1 }).success).toBe(false);
    const {
      prefer: _p,
      deny: _d,
      prompt: _pr,
      tier: _t,
      schema: _s,
      question_types: _q,
      max_questions_per_request: _m,
      ...minimal
    } = entry;
    expect(TaskRegistryEntry.safeParse(minimal).success).toBe(true);
  });

  it('UT-CON-131 ContextRef·ContextBlock · AI_GATEWAY_POLICY가 { deny_before_submit: [blank_note.*] }와 deep equal [FR-AI-020][NFR-UX-008]', () => {
    expect(ContextRef.safeParse(contextRef).success).toBe(true);
    expect(ContextRef.safeParse({ kind: 'blank_note', phase: 'pre_submit', id: 'n1' }).success).toBe(true);
    expect(ContextRef.safeParse({ ...contextRef, kind: 'diary' }).success).toBe(false);
    expect(ContextRef.safeParse({ ...contextRef, phase: 'during' }).success).toBe(false);
    expect(ContextRef.safeParse({ ...contextRef, id: 'x'.repeat(161) }).success).toBe(false);
    expect(ContextRef.shape.kind.options).toHaveLength(9);

    const block = { key: 'kus', text: '본문', data_class: 'C0', untrusted: false, source_ref: null };
    expect(ContextBlock.safeParse(block).success).toBe(true);
    expect(ContextBlock.safeParse({ ...block, data_class: 'C4' }).success).toBe(false);
    expect(ContextBlock.safeParse({ ...block, key: 'K' }).success).toBe(false);
    expect(ContextBlock.safeParse({ ...block, text: 'x'.repeat(200_001) }).success).toBe(false);
    expect(ContextBlock.safeParse({ ...block, untrusted: undefined }).success).toBe(false);

    expect(AI_GATEWAY_POLICY).toEqual({ deny_before_submit: ['blank_note.*'] });
    expect(AI_GATEWAY_POLICY.deny_before_submit).toHaveLength(1);
  });
});

describe('ai/judge-keys.ts keyedFromList', () => {
  it('UT-CON-132 keyedFromList("kp", 3개) → kp01~kp03·keymap, 100개 → kp001, 중복 id·잘못된 prefix(K) → RangeError [UR-16][FR-AI-005]', () => {
    const items = [{ id: 'k8s.probes.k01' }, { id: 'k8s.probes.k02' }, { id: 'k8s.probes.k03' }];
    const out = keyedFromList('kp', items, (i) => i.id);
    expect(Object.keys(out.map)).toEqual(['kp01', 'kp02', 'kp03']);
    expect(out.map.kp02).toBe(items[1]);
    expect(out.keymap).toEqual({ kp01: 'k8s.probes.k01', kp02: 'k8s.probes.k02', kp03: 'k8s.probes.k03' });

    const hundred = Array.from({ length: 100 }, (_, i) => ({ id: `id${i}` }));
    const big = keyedFromList('kp', hundred, (i) => i.id);
    expect(Object.keys(big.map)[0]).toBe('kp001');
    expect(Object.keys(big.map)[99]).toBe('kp100');
    expect(big.keymap.kp100).toBe('id99');
    // 99개는 폭 2, 100개는 폭 3
    const ninetyNine = keyedFromList('kp', hundred.slice(0, 99), (i) => i.id);
    expect(Object.keys(ninetyNine.map)[98]).toBe('kp99');

    expect(keyedFromList('mc', [], (i: { id: string }) => i.id)).toEqual({ map: {}, keymap: {} });
    expect(() => keyedFromList('K', items, (i) => i.id)).toThrow(RangeError);
    expect(() => keyedFromList('K', items, (i) => i.id)).toThrow('keyedFromList: invalid prefix');
    expect(() => keyedFromList('K', [], (i: { id: string }) => i.id)).toThrow(RangeError);
    expect(() => keyedFromList('1k', items, (i) => i.id)).toThrow(RangeError);
    expect(() => keyedFromList('a'.repeat(31), items, (i) => i.id)).toThrow(RangeError); // 키가 32자를 넘는다
    expect(() => keyedFromList('kp', [{ id: 'same' }, { id: 'same' }], (i) => i.id)).toThrow(
      'keyedFromList: duplicate id',
    );
    expect(() => keyedFromList('kp', [{ id: 'a' }, { id: 'b' }, { id: 'a' }], (i) => i.id)).toThrow(RangeError);
    // 결정적: 같은 입력 = 같은 출력
    expect(keyedFromList('opt', items, (i) => i.id)).toEqual(keyedFromList('opt', items, (i) => i.id));
  });
});
