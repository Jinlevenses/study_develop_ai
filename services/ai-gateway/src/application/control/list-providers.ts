import type { ProviderList } from '@fathom/contracts/http/ai-gateway/v1/providers';
import { assembleProviders } from '../../domain/control/provider-status.js';
import type { ControlStore } from './ports.js';

/** IF-AI-025 — 제공자 목록(카탈로그 순서 → `gcli-*` id 오름차순). */
export function listProviders(deps: { readonly store: ControlStore }): ProviderList {
  const { store } = deps;
  const states = assembleProviders({
    providers: store.listProviders(),
    consents: store.listLatestConsents(),
    probes: store.listProbes(),
  });
  return { providers: states.map((s) => s.view) };
}
