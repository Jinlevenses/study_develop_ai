import type { AiMode, ProviderKind, ProviderStatus } from '@fathom/contracts/common/domain';
import type { ModeReason } from '@fathom/contracts/http/ai-gateway/v1/mode';
import type { Billing } from './provider-catalog.js';
import type { ProviderState } from './provider-status.js';

// AI-01 §5.1 산정식 — 시그니처·J/L 식 그대로 전사. 순수(STD-DIR-04).

export type ModeInput = {
  readonly safeMode: boolean;
  readonly providers: readonly {
    readonly id: string;
    readonly kind: ProviderKind;
    readonly consent: { readonly judge: boolean; readonly generate: boolean; readonly batch: boolean };
    readonly status: ProviderStatus;
    readonly breakerOpen: { readonly judge: boolean; readonly generate: boolean };
    readonly billing: Billing;
    readonly budgetBlocked: boolean;
    readonly quotaBlocked: boolean;
  }[];
};
export type ModeResult = { readonly mode: AiMode; readonly reasons: readonly ModeReason[] };

const LLM_KINDS: ReadonlySet<ProviderKind> = new Set<ProviderKind>(['llm_api', 'llm_cli', 'local_llm', 'generic_cli']);
const usable = (status: ProviderStatus): boolean => status === 'ok' || status === 'degraded';

// J = ∃ p: p.id='jev' ∧ consent.judge ∧ status∈{ok,degraded} ∧ ¬breakerOpen.judge ∧ ¬budgetBlocked
// L = ∃ p: p.kind∈{llm_api,llm_cli,local_llm,generic_cli} ∧ consent.generate ∧ status∈{ok,degraded} ∧ ¬breakerOpen.generate ∧ ¬budgetBlocked ∧ ¬quotaBlocked
// safeMode → OFFLINE(safe_mode) · J∧L → FULL · J∧¬L → JUDGE_ONLY · ¬J∧L → LLM_ONLY · 그 외 → OFFLINE
export function computeMode(i: ModeInput): ModeResult {
  if (i.safeMode) {
    return { mode: 'OFFLINE', reasons: ['safe_mode'] };
  }
  const J = i.providers.some(
    (p) => p.id === 'jev' && p.consent.judge && usable(p.status) && !p.breakerOpen.judge && !p.budgetBlocked,
  );
  const L = i.providers.some(
    (p) =>
      LLM_KINDS.has(p.kind) &&
      p.consent.generate &&
      usable(p.status) &&
      !p.breakerOpen.generate &&
      !p.budgetBlocked &&
      !p.quotaBlocked,
  );
  if (J || L) {
    const reasons: ModeReason[] = ['consent_granted', 'probe_ok'];
    return { mode: J && L ? 'FULL' : J ? 'JUDGE_ONLY' : 'LLM_ONLY', reasons };
  }
  const consented = i.providers.filter((p) => p.consent.judge || p.consent.generate || p.consent.batch);
  if (consented.length === 0) {
    return { mode: 'OFFLINE', reasons: ['no_consent'] };
  }
  const reasons: ModeReason[] = [];
  if (consented.some((p) => !usable(p.status))) {
    reasons.push('probe_failed');
  }
  if (consented.some((p) => p.breakerOpen.judge || p.breakerOpen.generate)) {
    reasons.push('breaker_open');
  }
  if (consented.some((p) => p.budgetBlocked)) {
    reasons.push('budget_exhausted');
  }
  if (consented.some((p) => p.quotaBlocked)) {
    reasons.push('quota_exhausted');
  }
  return { mode: 'OFFLINE', reasons: reasons.length === 0 ? ['probe_failed'] : reasons };
}

/**
 * 저장 상태 → 산정 입력. R0: 브레이커 전부 닫힘, 예산·쿼터 차단 없음(IT-04 몫).
 * 동의 scope가 곧 `consent.*`이므로 상태 산정(`unconsented`)과 일관된다.
 */
export function toModeInput(safeMode: boolean, states: readonly ProviderState[]): ModeInput {
  return {
    safeMode,
    providers: states.map((s) => ({
      id: s.meta.provider_id,
      kind: s.meta.kind,
      consent: {
        judge: s.consent.scopes.includes('judge'),
        generate: s.consent.scopes.includes('generate'),
        batch: s.consent.scopes.includes('batch'),
      },
      status: s.status,
      breakerOpen: { judge: false, generate: false },
      billing: s.meta.billing,
      budgetBlocked: false,
      quotaBlocked: false,
    })),
  };
}
