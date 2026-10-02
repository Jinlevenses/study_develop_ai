import type { ModeView } from '@fathom/contracts/http/ai-gateway/v1/mode';
import { ModeGetRoute } from '@fathom/contracts/http/ai-gateway/v1/mode';
import type { ProviderList } from '@fathom/contracts/http/ai-gateway/v1/providers';
import { ProvidersListRoute } from '@fathom/contracts/http/ai-gateway/v1/providers';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';

/** IF-AI-025 `GET /internal/v1/providers` · IF-AI-039 `GET /internal/v1/mode`. */
export function registerControlRoutes(
  app: ServiceApp,
  rt: { readonly mode: () => ModeView; readonly providers: () => ProviderList },
): void {
  app.route(ModeGetRoute, () => Promise.resolve({ status: 200 as const, body: rt.mode() }));
  app.route(ProvidersListRoute, () => Promise.resolve({ status: 200 as const, body: rt.providers() }));
}
