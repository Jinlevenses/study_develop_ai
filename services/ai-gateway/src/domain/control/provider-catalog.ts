import type { ProviderKind } from '@fathom/contracts/common/domain';
import { ProviderFamily } from '@fathom/contracts/http/ai-gateway/v1/providers';

// AI-01 §3.2 어댑터 역량 행렬 — 내장 제공자 8행(= DB-01 §14.3 첫 기동 시드). 순수 상수·매핑(STD-DIR-04).

export type DbProviderKind =
  | 'jev'
  | 'anthropic_api'
  | 'openai_api'
  | 'gemini_api'
  | 'ollama'
  | 'claude_cli'
  | 'codex_cli'
  | 'gemini_cli'
  | 'generic_cli';
export type Billing = 'metered' | 'subscription' | 'free' | 'local';
export type Trust = 'verified' | 'unverified';
export type ConsentScope = 'judge' | 'generate' | 'batch';
export type Capabilities = {
  readonly structured_output: boolean;
  readonly json_schema_flag: boolean;
  readonly streaming: boolean;
  readonly multi_turn: boolean;
};

export type CatalogEntry = {
  readonly provider_id: string;
  readonly db_kind: Exclude<DbProviderKind, 'generic_cli'>;
  readonly kind: Exclude<ProviderKind, 'generic_cli'>;
  readonly family: ProviderFamily;
  readonly display_name: string;
  readonly billing: Billing;
  readonly trust: Trust;
  readonly external_processor: boolean;
  readonly capabilities: Capabilities;
};

const caps = (structured: boolean, jsonSchema: boolean, streaming: boolean): Capabilities => ({
  structured_output: structured,
  json_schema_flag: jsonSchema,
  streaming,
  multi_turn: false,
});

/** 순서 = 목록·응답 순서(Brief 결정). */
export const BUILTIN_PROVIDERS: readonly CatalogEntry[] = [
  {
    provider_id: 'jev',
    db_kind: 'jev',
    kind: 'jev',
    family: 'typesafe',
    display_name: 'Jev',
    billing: 'metered',
    trust: 'verified',
    external_processor: true,
    capabilities: caps(false, false, false),
  },
  {
    provider_id: 'anthropic-api',
    db_kind: 'anthropic_api',
    kind: 'llm_api',
    family: 'anthropic',
    display_name: 'Anthropic API',
    billing: 'metered',
    trust: 'verified',
    external_processor: true,
    capabilities: caps(true, true, true),
  },
  {
    provider_id: 'openai-api',
    db_kind: 'openai_api',
    kind: 'llm_api',
    family: 'openai',
    display_name: 'OpenAI API',
    billing: 'metered',
    trust: 'verified',
    external_processor: true,
    capabilities: caps(true, true, true),
  },
  {
    provider_id: 'gemini-api',
    db_kind: 'gemini_api',
    kind: 'llm_api',
    family: 'google',
    display_name: 'Gemini API',
    billing: 'metered',
    trust: 'verified',
    external_processor: true,
    capabilities: caps(true, false, true),
  },
  {
    provider_id: 'ollama',
    db_kind: 'ollama',
    kind: 'local_llm',
    family: 'local',
    display_name: 'Ollama',
    billing: 'local',
    trust: 'verified',
    external_processor: false,
    capabilities: caps(true, false, true),
  },
  {
    provider_id: 'claude-cli',
    db_kind: 'claude_cli',
    kind: 'llm_cli',
    family: 'anthropic',
    display_name: 'Claude CLI',
    billing: 'subscription',
    trust: 'unverified',
    external_processor: true,
    capabilities: caps(true, true, false),
  },
  {
    provider_id: 'codex-cli',
    db_kind: 'codex_cli',
    kind: 'llm_cli',
    family: 'openai',
    display_name: 'Codex CLI',
    billing: 'subscription',
    trust: 'unverified',
    external_processor: true,
    capabilities: caps(true, true, false),
  },
  {
    provider_id: 'gemini-cli',
    db_kind: 'gemini_cli',
    kind: 'llm_cli',
    family: 'google',
    display_name: 'Gemini CLI',
    billing: 'subscription',
    trust: 'unverified',
    external_processor: true,
    capabilities: caps(false, false, false),
  },
];

const CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(BUILTIN_PROVIDERS.map((e) => [e.provider_id, e]));
const CATALOG_INDEX: ReadonlyMap<string, number> = new Map(BUILTIN_PROVIDERS.map((e, i) => [e.provider_id, i]));

/** `ai_provider` 한 행(저장소가 읽어 온 모양, 비밀 값 없음). */
export type ProviderRow = {
  readonly provider_id: string;
  readonly kind: string;
  readonly display_name: string;
  readonly billing: Billing;
  readonly trust: Trust;
  readonly enabled: number;
  readonly config_json: string;
};

/** 응답에 필요한 제공자 메타(카탈로그 또는 `gcli-*` 설정에서 유도). */
export type ProviderMeta = {
  readonly provider_id: string;
  readonly kind: ProviderKind;
  readonly family: ProviderFamily;
  readonly display_name: string;
  readonly billing: Billing;
  readonly trust: Trust;
  readonly external_processor: boolean;
  readonly capabilities: Capabilities;
};

type Config = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfig(json: string): Config {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function genericCapabilities(config: Config): Capabilities {
  const raw = config.capabilities;
  const c: Config = isRecord(raw) ? raw : {};
  return caps(c.structured_output === true, c.json_schema_flag === true, c.streaming === true);
}

/**
 * 메타 유도: 내장 8행 = 카탈로그(표시 이름·과금·신뢰는 저장 행이 정본 — 사용자 설정·canary 결과가 바꾼다),
 * `gcli-*` = kind generic_cli · family `config_json.family ?? 'other'` · trust unverified · 나머지 `config_json`(없으면 ✓·전부 ✗).
 * 카탈로그에도 `gcli-*`에도 속하지 않는 행은 `null`(CHECK가 막으므로 방어용).
 */
export function providerMeta(row: ProviderRow): ProviderMeta | null {
  const entry = CATALOG_BY_ID.get(row.provider_id);
  if (entry !== undefined) {
    return {
      provider_id: entry.provider_id,
      kind: entry.kind,
      family: entry.family,
      display_name: row.display_name,
      billing: row.billing,
      trust: row.trust,
      external_processor: entry.external_processor,
      capabilities: entry.capabilities,
    };
  }
  if (!row.provider_id.startsWith('gcli-')) {
    return null;
  }
  const config = parseConfig(row.config_json);
  const parsedFamily = ProviderFamily.safeParse(config.family);
  return {
    provider_id: row.provider_id,
    kind: 'generic_cli',
    family: parsedFamily.success ? parsedFamily.data : 'other',
    display_name: row.display_name,
    billing: row.billing,
    trust: 'unverified',
    external_processor: config.external_processor !== false,
    capabilities: genericCapabilities(config),
  };
}

/** 카탈로그 순서 → `gcli-*` id 오름차순(Brief §4.2). */
export function compareProviders(a: { readonly provider_id: string }, b: { readonly provider_id: string }): number {
  const ia = CATALOG_INDEX.get(a.provider_id);
  const ib = CATALOG_INDEX.get(b.provider_id);
  if (ia !== undefined && ib !== undefined) {
    return ia - ib;
  }
  if (ia !== undefined) {
    return -1;
  }
  if (ib !== undefined) {
    return 1;
  }
  return a.provider_id < b.provider_id ? -1 : a.provider_id > b.provider_id ? 1 : 0;
}
