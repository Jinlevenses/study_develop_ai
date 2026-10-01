import { SessionCsrfRoute, SessionExchangeRoute, SessionStatusRoute } from '@fathom/contracts/http/gateway/v1/session';
import type { SessionStatus as SessionStatusT } from '@fathom/contracts/http/gateway/v1/session';
import type { ApiClient, ApiFailure } from './api-client.js';
import { APP_VERSION } from './app-version.js';
import type { CsrfStore } from './csrf.js';

export type BootState =
  | { readonly kind: 'ready'; readonly status: SessionStatusT; readonly versionMismatch: boolean }
  | { readonly kind: 'session_lost'; readonly code: string }
  | { readonly kind: 'app_off' }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export interface BootstrapDeps {
  readonly location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  readonly history: Pick<History, 'replaceState' | 'state'>;
  readonly api: ApiClient;
  readonly csrf: CsrfStore;
}

const BT_PREFIX = '#bt=';
const BT_RE = /^[A-Za-z0-9_-]{43}$/;

/** `#bt=<43자 base64url>`만 인정한다(앞뒤에 다른 문자가 있으면 null). */
export function readBootstrapToken(hash: string): string | null {
  if (!hash.startsWith(BT_PREFIX)) {
    return null;
  }
  const token = hash.slice(BT_PREFIX.length);
  return BT_RE.test(token) ? token : null;
}

function failureToState(failure: ApiFailure): BootState {
  if (failure.kind === 'network') {
    return { kind: 'app_off' };
  }
  return { kind: 'error', failure };
}

/** IF-GW-002·006·003 부트스트랩(NFR-SEC-019, FR-SET-023). 토큰은 어디에도 남기지 않는다. */
export async function bootstrapSession(deps: BootstrapDeps): Promise<BootState> {
  const { location, history, api, csrf } = deps;
  const hash = location.hash;
  const hasBt = hash.startsWith(BT_PREFIX);
  const bt = readBootstrapToken(hash);
  if (hasBt) {
    // 어떤 await보다 먼저 해시를 지운다 — 토큰이 주소창·히스토리에 남지 않게(UT-WEB-003).
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  if (bt !== null) {
    const ex = await api.call(SessionExchangeRoute, { body: { bt } });
    if (!ex.ok) {
      const reuse = ex.kind === 'problem' && ex.status === 401 && ex.problem.code === 'GW-AUTH-004';
      if (!reuse) {
        return failureToState(ex);
      }
    }
  }
  const status = await api.call(SessionStatusRoute, {});
  if (!status.ok) {
    if (status.kind === 'problem' && status.status === 401) {
      return { kind: 'session_lost', code: status.problem.code };
    }
    return failureToState(status);
  }
  const token = await api.call(SessionCsrfRoute, {});
  if (!token.ok) {
    if (token.kind === 'problem' && token.status === 401) {
      return { kind: 'session_lost', code: token.problem.code };
    }
    return failureToState(token);
  }
  try {
    csrf.set(token.data.csrf);
  } catch {
    return { kind: 'error', failure: { kind: 'contract', status: 200, detail: 'csrf 형식 위반' } };
  }
  return { kind: 'ready', status: status.data, versionMismatch: status.data.app_version !== APP_VERSION };
}
