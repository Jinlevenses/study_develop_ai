import type { ModeView } from '@fathom/contracts/http/ai-gateway/v1/mode';
import { assembleProviders } from '../../domain/control/provider-status.js';
import type { ControlStore } from './ports.js';

/** IF-AI-039 — 저장된 모드 상태 + 이전 모드 + 카탈로그 순서의 제공자 요약. */
export function getMode(deps: { readonly store: ControlStore; readonly safeMode: boolean }): ModeView {
  const { store } = deps;
  const state = store.readModeState();
  const states = assembleProviders({
    providers: store.listProviders(),
    consents: store.listLatestConsents(),
    probes: store.listProbes(),
  });
  return {
    mode: state.mode,
    previous_mode: store.readPreviousMode(),
    reasons: [...state.reasons],
    providers: states.map((s) => ({ id: s.meta.provider_id, kind: s.meta.kind, status: s.status })),
    changed_at: state.changed_at,
    safe_mode: deps.safeMode,
  };
}
