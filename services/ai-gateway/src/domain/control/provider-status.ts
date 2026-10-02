import type { ProviderStatus } from '@fathom/contracts/common/domain';
import type { ProviderView } from '@fathom/contracts/http/ai-gateway/v1/providers';
import type { ConsentScope, ProviderMeta, ProviderRow } from './provider-catalog.js';
import { compareProviders, providerMeta } from './provider-catalog.js';

// AI-01 §3.3 status 산정 · Brief §4.1 — 제공자 상태·동의 집계·`ProviderView` 매핑. 순수.

/** `ai_consent` 한 행(append-only, 최신 행이 유효). */
export type ConsentRow = {
  readonly provider_id: string;
  readonly scope: ConsentScope;
  readonly granted: number;
  readonly decided_at: number;
};
/** `ai_probe` 한 행(제공자별 최신 1행). */
export type ProbeRow = {
  readonly provider_id: string;
  readonly status: ProviderStatus;
  readonly version: string | null;
  readonly flags_ok: number;
  readonly reason_code: string | null;
  readonly probed_at: number;
};

export type ConsentSummary = {
  readonly scopes: readonly ConsentScope[];
  readonly granted_at: number | null;
};

const SCOPE_ORDER: readonly ConsentScope[] = ['judge', 'generate', 'batch'];

/**
 * `(provider_id, scope)`별 최신 `decided_at` 행의 `granted = 1`만 남긴다(철회 반영).
 * 같은 `decided_at`이면 입력 순서상 뒤의 행이 이긴다(저장소는 오름차순으로 읽는다).
 */
export function summarizeConsents(rows: readonly ConsentRow[]): ReadonlyMap<string, ConsentSummary> {
  const latest = new Map<string, ConsentRow>();
  for (const row of rows) {
    const key = `${row.provider_id}\u0000${row.scope}`;
    const prev = latest.get(key);
    if (prev === undefined || row.decided_at >= prev.decided_at) {
      latest.set(key, row);
    }
  }
  const scopes = new Map<string, ConsentScope[]>();
  const grantedAt = new Map<string, number>();
  for (const row of latest.values()) {
    if (row.granted !== 1) {
      continue;
    }
    scopes.set(row.provider_id, [...(scopes.get(row.provider_id) ?? []), row.scope]);
    grantedAt.set(row.provider_id, Math.max(grantedAt.get(row.provider_id) ?? 0, row.decided_at));
  }
  const out = new Map<string, ConsentSummary>();
  for (const [id, list] of scopes) {
    out.set(id, {
      scopes: [...list].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b)),
      granted_at: grantedAt.get(id) ?? null,
    });
  }
  return out;
}

/** `enabled = 0` → disabled · 동의 scope 0개 → unconsented · probe 행 없음 → down · 그 밖 `ai_probe.status`. */
export function deriveProviderStatus(i: {
  readonly enabled: boolean;
  readonly consentScopes: readonly ConsentScope[];
  readonly probeStatus: ProviderStatus | null;
}): ProviderStatus {
  if (!i.enabled) {
    return 'disabled';
  }
  if (i.consentScopes.length === 0) {
    return 'unconsented';
  }
  return i.probeStatus ?? 'down';
}

export type ProviderState = {
  readonly meta: ProviderMeta;
  readonly status: ProviderStatus;
  readonly consent: ConsentSummary;
  readonly view: ProviderView;
};

function toView(meta: ProviderMeta, status: ProviderStatus, consent: ConsentSummary, probe: ProbeRow | null): ProviderView {
  return {
    provider_id: meta.provider_id,
    kind: meta.kind,
    family: meta.family,
    display_name: meta.display_name,
    status,
    consent: { granted: consent.scopes.length > 0, granted_at: consent.granted_at, scopes: [...consent.scopes] },
    probe:
      probe === null
        ? null
        : {
            installed: probe.status !== 'down',
            version: probe.version,
            logged_in: null,
            flags_ok: probe.flags_ok === 1,
            missing_flags: [],
            key_present: null,
            models: [],
            latency_ms: null,
            checked_at: probe.probed_at,
            reason_code: probe.reason_code,
          },
    breaker: 'closed',
    billing_mode: meta.billing,
    trust: meta.trust,
    models_by_tier: { low: null, mid: null, high: null },
    capabilities: { ...meta.capabilities },
    external_processor: meta.external_processor,
  };
}

/** 저장 행 3종 → 카탈로그 순서의 제공자 상태 목록(카탈로그 → `gcli-*` id 오름차순). */
export function assembleProviders(i: {
  readonly providers: readonly ProviderRow[];
  readonly consents: readonly ConsentRow[];
  readonly probes: readonly ProbeRow[];
}): ProviderState[] {
  const consents = summarizeConsents(i.consents);
  const probes = new Map(i.probes.map((p) => [p.provider_id, p]));
  const states: ProviderState[] = [];
  for (const row of [...i.providers].sort(compareProviders)) {
    const meta = providerMeta(row);
    if (meta === null) {
      continue;
    }
    const consent = consents.get(row.provider_id) ?? { scopes: [], granted_at: null };
    const probe = probes.get(row.provider_id) ?? null;
    const status = deriveProviderStatus({
      enabled: row.enabled === 1,
      consentScopes: consent.scopes,
      probeStatus: probe?.status ?? null,
    });
    states.push({ meta, status, consent, view: toView(meta, status, consent, probe) });
  }
  return states;
}
