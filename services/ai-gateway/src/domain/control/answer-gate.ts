import type { GenerateRequest, GenerateResult } from '@fathom/contracts/ai/generate';
import type { JudgeRequest, JudgeResult } from '@fathom/contracts/ai/judge';
import { AI_GATEWAY_POLICY } from '@fathom/contracts/ai/ai-gateway-policy';
import { GenerateTaskId, JudgeTaskId } from '@fathom/contracts/ai/tasks';
import type { AiMode } from '@fathom/contracts/common/domain';

// AI-01 §6.1 응답 게이트 — judge·generate 요청을 외부 호출 없이 판정한다(R0: 항상 unavailable 또는 거절). 순수(STD-DIR-04).
// RegistryView·GateDecision은 control BC가 소유한다(check:boundaries bc-cross — routing·generate 결과는 infra/assets가 옮긴다).

export type PromptState = 'ok' | 'absent' | 'mismatch';
export type RegistryView = {
  readonly tasks: ReadonlyMap<
    string,
    {
      readonly kind: 'judge' | 'generate';
      readonly lane: 'interactive' | 'conversational' | 'background';
      readonly prompt: PromptState;
    }
  >;
  /** IF-OP-025 `DoctorReport.items[]` 한 항목 모양. 노출 경로(ops doctor 결선)는 IT-02. */
  readonly doctor: {
    readonly id: 'prompts_lock';
    readonly status: 'ok' | 'warn';
    readonly summary_ko: string;
    readonly mismatched_tasks: readonly string[];
  };
};

export type GateRejection = 'AI-NOTFOUND-001' | 'AI-POLICY-001' | 'AI-POLICY-002' | 'AI-VAL-011';
export type GateDecision<T> =
  | { readonly ok: true; readonly result: T }
  | { readonly ok: false; readonly code: GateRejection };

const MAX_QUESTIONS = 15;

function reject<T>(code: GateRejection): GateDecision<T> {
  return { ok: false, code };
}
function unavailableJudge(reason: 'offline' | 'no_consented_provider' | 'task_disabled'): GateDecision<JudgeResult> {
  return { ok: true, result: { status: 'unavailable', reason, retry_after_ms: null } };
}
function unavailableGenerate(
  reason: 'offline' | 'no_consented_provider' | 'task_disabled',
): GateDecision<GenerateResult> {
  return { ok: true, result: { status: 'unavailable', reason, retry_after_ms: null } };
}

/** `*` = 임의 문자열 glob, 그 밖의 문자는 글자 그대로. */
function globMatches(pattern: string, text: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(text);
}

/** `context_ref`가 제출 전이고 `<kind>.<phase>`가 `deny_before_submit` 패턴에 걸리면 true(NG-G7). */
export function isDeniedBeforeSubmit(ref: { readonly kind: string; readonly phase: string }): boolean {
  if (ref.phase !== 'pre_submit') {
    return false;
  }
  const key = `${ref.kind}.${ref.phase}`;
  return AI_GATEWAY_POLICY.deny_before_submit.some((pattern) => globMatches(pattern, key));
}

/**
 * judge 순서: ① 과업 없음/종류 불일치 ② 질문 수 1..15 ③ background는 work_order 필수 ④ 프롬프트 lock 불일치(task_disabled)
 * ⑤ OFFLINE ⑥ 프롬프트 파일 없음(task_disabled) ⑦ 그 밖(라우터·어댑터는 IT-04) → no_consented_provider.
 */
export function decideJudge(i: {
  readonly taskId: string;
  readonly body: JudgeRequest;
  readonly registry: RegistryView;
  readonly mode: AiMode;
}): GateDecision<JudgeResult> {
  const entry = i.registry.tasks.get(i.taskId);
  if (!JudgeTaskId.safeParse(i.taskId).success || entry === undefined || entry.kind !== 'judge') {
    return reject('AI-NOTFOUND-001');
  }
  const questions = Object.keys(i.body.questions).length;
  if (questions < 1 || questions > MAX_QUESTIONS) {
    return reject('AI-VAL-011');
  }
  if (i.body.lane === 'background' && i.body.work_order_id === null) {
    return reject('AI-POLICY-002');
  }
  if (entry.prompt === 'mismatch') {
    return unavailableJudge('task_disabled');
  }
  if (i.mode === 'OFFLINE') {
    return unavailableJudge('offline');
  }
  if (entry.prompt === 'absent') {
    return unavailableJudge('task_disabled');
  }
  return unavailableJudge('no_consented_provider');
}

/**
 * generate 순서: ① presubmit-guard(`blank_note.pre_submit` 등) ② 과업 없음/종류 불일치 ③ lock 불일치(task_disabled)
 * ④ OFFLINE → offline · JUDGE_ONLY → no_consented_provider ⑤ 프롬프트 파일 없음(task_disabled) ⑥ 그 밖 → no_consented_provider.
 */
export function decideGenerate(i: {
  readonly taskId: string;
  readonly body: GenerateRequest;
  readonly registry: RegistryView;
  readonly mode: AiMode;
}): GateDecision<GenerateResult> {
  if (isDeniedBeforeSubmit(i.body.context_ref)) {
    return reject('AI-POLICY-001');
  }
  const entry = i.registry.tasks.get(i.taskId);
  if (!GenerateTaskId.safeParse(i.taskId).success || entry === undefined || entry.kind !== 'generate') {
    return reject('AI-NOTFOUND-001');
  }
  if (entry.prompt === 'mismatch') {
    return unavailableGenerate('task_disabled');
  }
  if (i.mode === 'OFFLINE') {
    return unavailableGenerate('offline');
  }
  if (i.mode === 'JUDGE_ONLY') {
    return unavailableGenerate('no_consented_provider');
  }
  if (entry.prompt === 'absent') {
    return unavailableGenerate('task_disabled');
  }
  return unavailableGenerate('no_consented_provider');
}
