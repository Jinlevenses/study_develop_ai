import { describe, expect, it } from 'vitest';
import { AiErrorClass } from '../../../src/ai/errors.js';
import {
  JudgeAnswer,
  JudgeJobPayload,
  JudgeRequest,
  JudgeResult,
  JudgeState,
  JudgeUnavailableReason,
  QuestionInstance,
} from '../../../src/ai/judge.js';
import { StreamDelta, StreamDone, StreamError, StreamMeta } from '../../../src/ai/stream.js';
import { judgeJobPayload, judgeOk, judgeRequest, noulAnswer, SHA, ULID } from './samples.js';

describe('ai/errors.ts · stream.ts', () => {
  it('UT-CON-133 AiErrorClass 16값 · ai/stream.ts 4종(StreamError.code 3값, StreamDelta.text 4001자 거부) [IR-016]', () => {
    expect(AiErrorClass.options).toHaveLength(16);
    expect(AiErrorClass.safeParse('CONTENT_REFUSED').success).toBe(true);
    expect(AiErrorClass.safeParse('UNKNOWN').success).toBe(false);

    const meta = { ref: ULID, task_id: 'AI-G07', prompt_version: '1.0.0', provider_kind: 'llm_api', started_at: 1 };
    expect(StreamMeta.safeParse(meta).success).toBe(true);
    expect(StreamMeta.safeParse({ ...meta, task_id: 'AI-J01' }).success).toBe(false); // 스트림은 생성 과업만
    expect(StreamMeta.safeParse({ ...meta, provider_kind: 'jev' }).success).toBe(false);

    expect(StreamDelta.safeParse({ seq: 1, text: 'a'.repeat(4000) }).success).toBe(true);
    expect(StreamDelta.safeParse({ seq: 1, text: 'a'.repeat(4001) }).success).toBe(false);
    expect(StreamDelta.safeParse({ seq: 0, text: 'a' }).success).toBe(false);

    const done = {
      seq: 5,
      finish: 'stop',
      text_sha256: SHA,
      chars: 10,
      output: { move: 'probe_why', reveals_answer: false },
    };
    expect(StreamDone.safeParse(done).success).toBe(true);
    expect(StreamDone.safeParse({ ...done, output: null }).success).toBe(true);
    expect(StreamDone.safeParse({ ...done, finish: 'error' }).success).toBe(false);

    expect(StreamError.shape.code.options).toEqual(['AI-DEP-001', 'AI-DEP-002', 'AI-DEP-003']);
    expect(StreamError.safeParse({ seq: 2, code: 'AI-DEP-003', fallback_text_md: null }).success).toBe(true);
    expect(StreamError.safeParse({ seq: 2, code: 'AI-DEP-004', fallback_text_md: null }).success).toBe(false);
    expect(StreamError.safeParse({ seq: 2, code: 'AI-DEP-001', fallback_text_md: 'x'.repeat(4001) }).success).toBe(
      false,
    );
  });
});

const nest = (depth: number): Record<string, unknown> => {
  // 최상위 record = 깊이 1, 값이 record이면 +1
  let node: unknown = 'leaf';
  for (let d = depth; d >= 1; d -= 1) {
    node = { [`lv${d}`]: node };
  }
  return node as Record<string, unknown>;
};
const messages = (v: unknown): string[] => {
  const r = JudgeState.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('ai/judge.ts', () => {
  it('UT-CON-134 JudgeState: 깊이 4 통과·5 거부(메시지 AI-VAL-010 포함), 배열 값 거부, 65,537바이트 거부, 키 KP 거부 [UR-16][FR-AI-005]', () => {
    expect(JudgeState.safeParse(nest(1)).success).toBe(true);
    expect(JudgeState.safeParse(nest(4)).success).toBe(true);
    const deep = messages(nest(5));
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.some((m) => m.includes('AI-VAL-010'))).toBe(true);
    expect(deep.some((m) => m.includes('depth > 4'))).toBe(true);
    expect(JudgeState.safeParse(nest(6)).success).toBe(false);

    // 원시값 종류
    expect(JudgeState.safeParse({ ab: 'x', cd: 1, ef: true, gh: null, ij: { kl: 2 } }).success).toBe(true);
    // 배열 값은 거부(UR-16: 배열 없음)
    expect(JudgeState.safeParse({ ab: ['x'] }).success).toBe(false);
    expect(JudgeState.safeParse({ ab: { cd: [1, 2] } }).success).toBe(false);
    expect(JudgeState.safeParse({ ab: { cd: { ef: [] } } }).success).toBe(false);
    // 키는 ObjKey(소문자 시작 2~32자)
    expect(JudgeState.safeParse({ KP: 'x' }).success).toBe(false);
    expect(JudgeState.safeParse({ ab: { KP: 'x' } }).success).toBe(false);
    expect(JudgeState.safeParse({ k: 'x' }).success).toBe(false);
    expect(JudgeState.safeParse({ '0': 'x' }).success).toBe(false);
    // 문자열 값 20,000자 상한
    expect(JudgeState.safeParse({ ab: 'x'.repeat(20_000) }).success).toBe(true);
    expect(JudgeState.safeParse({ ab: 'x'.repeat(20_001) }).success).toBe(false);

    // canonicalJson UTF-8 바이트 ≤ 65,536: {"k1":..,"k2":..,"k3":..,"k4":..} = 33 + Σ문자 수
    const sized = (last: number) => ({
      k1: 'a'.repeat(20_000),
      k2: 'a'.repeat(20_000),
      k3: 'a'.repeat(20_000),
      k4: 'a'.repeat(last),
    });
    expect(JudgeState.safeParse(sized(5503)).success).toBe(true); // 정확히 65,536바이트
    const over = messages(sized(5504)); // 65,537바이트
    expect(over.some((m) => m.includes('AI-VAL-010') && m.includes('65536 bytes'))).toBe(true);
    // 글자 수가 아니라 UTF-8 바이트로 잰다(한글 = 3바이트)
    const korean = { k1: '가'.repeat(12_000), k2: '가'.repeat(12_000) };
    expect(korean.k1.length + korean.k2.length).toBeLessThan(65_536);
    expect(JudgeState.safeParse(korean).success).toBe(false);
    // 키 순서와 무관(canonical = 키 사전순)
    expect(
      JudgeState.safeParse({
        k4: 'a'.repeat(5503),
        k3: 'a'.repeat(20_000),
        k2: 'a'.repeat(20_000),
        k1: 'a'.repeat(20_000),
      }).success,
    ).toBe(true);
  });

  it('UT-CON-135 QuestionInstance.vars ObjPath, JudgeRequest(template_version active·1.2.0 통과, deadline_ms 99 거부) [FR-AI-005]', () => {
    const q = { template: 'covered', vars: { kp: 'key_points.kp01' } };
    expect(QuestionInstance.safeParse(q).success).toBe(true);
    expect(QuestionInstance.safeParse({ ...q, vars: { kp: 'key_points.kp01.a.b.c' } }).success).toBe(false); // ObjPath 최대 4단
    expect(QuestionInstance.safeParse({ ...q, vars: { kp: 'Key_Points.kp01' } }).success).toBe(false);
    expect(QuestionInstance.safeParse({ ...q, vars: { KP: 'key_points.kp01' } }).success).toBe(false);
    expect(QuestionInstance.safeParse({ ...q, vars: { kp: 'key_points.0' } }).success).toBe(false); // 배열 인덱스 경로 금지
    expect(QuestionInstance.safeParse({ ...q, template: 'T' }).success).toBe(false);
    expect(QuestionInstance.safeParse({ ...q, instructions: '직접 지시' }).success).toBe(false); // 호출자는 instructions 문자열을 보내지 않는다

    expect(JudgeRequest.safeParse(judgeRequest).success).toBe(true);
    expect(JudgeRequest.safeParse({ ...judgeRequest, template_version: '1.2.0' }).success).toBe(true);
    expect(JudgeRequest.safeParse({ ...judgeRequest, template_version: 'latest' }).success).toBe(false);
    expect(JudgeRequest.safeParse({ ...judgeRequest, deadline_ms: 99 }).success).toBe(false);
    expect(JudgeRequest.safeParse({ ...judgeRequest, deadline_ms: 100 }).success).toBe(true);
    expect(JudgeRequest.safeParse({ ...judgeRequest, deadline_ms: 10_000 }).success).toBe(true);
    expect(JudgeRequest.safeParse({ ...judgeRequest, deadline_ms: 10_001 }).success).toBe(false);
    expect(JudgeRequest.safeParse({ ...judgeRequest, lane: 'conversational' }).success).toBe(false);
    expect(JudgeRequest.safeParse({ ...judgeRequest, task_id: 'AI-J03' }).success).toBe(false); // task_id는 경로 파라미터
    expect(JudgeRequest.safeParse({ ...judgeRequest, work_order_id: ULID }).success).toBe(true);
    expect(JudgeRequest.safeParse({ ...judgeRequest, untrusted_keys: Array(33).fill('key_points') }).success).toBe(
      false,
    );
    expect(JudgeRequest.safeParse({ ...judgeRequest, state: { key_points: ['a'] } }).success).toBe(false);
  });

  it('UT-CON-136 JudgeAnswer 3종, JudgeResult 3 status, JudgeJobPayload [FR-AI-008]', () => {
    const choice = { type: 'choice', choice: 'opt_a', confidence: 0.8, probabilities: { opt_a: 0.8, opt_b: 0.2 } };
    const score = { type: 'score', score: 2.5, confidence: 0.7, probabilities: { '0': 0.1, '3': 0.9 }, levels: 4 };
    expect(JudgeAnswer.options).toHaveLength(3);
    for (const a of [noulAnswer, choice, score]) {
      expect(JudgeAnswer.safeParse(a).success, a.type).toBe(true);
      expect(JudgeAnswer.safeParse({ ...a, extra: 1 }).success, `${a.type}+extra`).toBe(false);
    }
    expect(JudgeAnswer.safeParse({ ...noulAnswer, p_yes: 1.1 }).success).toBe(false);
    expect(JudgeAnswer.safeParse({ ...score, levels: 1 }).success).toBe(false);
    expect(JudgeAnswer.safeParse({ ...score, probabilities: { x: 0.5 } }).success).toBe(false);
    expect(JudgeAnswer.safeParse({ type: 'rank' }).success).toBe(false);

    const unavailable = { status: 'unavailable', reason: 'offline', retry_after_ms: null };
    const deferred = { status: 'deferred', reason: 'background_queued', job_id: null };
    expect(JudgeResult.options).toHaveLength(3);
    for (const r of [judgeOk, unavailable, deferred]) {
      expect(JudgeResult.safeParse(r).success, r.status).toBe(true);
    }
    expect(JudgeResult.safeParse({ ...judgeOk, engine: 'H' }).success).toBe(false);
    expect(JudgeResult.safeParse({ ...judgeOk, confidence: 1.5 }).success).toBe(false);
    expect(JudgeResult.safeParse({ ...unavailable, reason: 'mystery' }).success).toBe(false);
    expect(JudgeResult.safeParse({ ...deferred, reason: 'offline' }).success).toBe(false);
    expect(JudgeResult.safeParse({ status: 'failed' }).success).toBe(false);
    expect(JudgeUnavailableReason.options).toHaveLength(13);

    expect(JudgeJobPayload.safeParse(judgeJobPayload).success).toBe(true);
    expect(JudgeJobPayload.safeParse({ ...judgeJobPayload, lane: 'background' }).success).toBe(false);
    expect(
      JudgeJobPayload.safeParse({
        ...judgeJobPayload,
        family_exclude: ['anthropic', 'openai', 'google', 'local', 'other'],
      }).success,
    ).toBe(false);
  });
});
