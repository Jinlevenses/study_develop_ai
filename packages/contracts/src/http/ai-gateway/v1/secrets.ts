import { z } from 'zod';
import { ProviderId } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const PutSecretBody = S({
  secret: z.string().min(8).max(4096),
  store: z.enum(['auto', 'keychain', 'file']),
  verify: z.boolean(),
});
export type PutSecretBody = z.infer<typeof PutSecretBody>;
export const SecretMeta = S({
  provider_id: ProviderId,
  source: z.enum(['keychain', 'file', 'env']),
  last4: z.string().length(4),
  verified_at: EpochMs.nullable(),
});
export type SecretMeta = z.infer<typeof SecretMeta>;
export const SecretList = S({
  secrets: z.array(SecretMeta).max(16),
  store: S({
    backend: z.enum(['keychain', 'file', 'env_only']),
    locked: z.boolean(),
    kek_kind: z.enum(['os', 'passphrase']).nullable(),
  }),
});
export type SecretList = z.infer<typeof SecretList>;
export const UnlockSecretsBody = S({ passphrase: z.string().min(12).max(1024) }); // scrypt(N=2^17,r=8,p=1,maxmem=256MiB)
export type UnlockSecretsBody = z.infer<typeof UnlockSecretsBody>;
export const UnlockResult = S({ unlocked: z.boolean(), providers: z.array(ProviderId) });
export type UnlockResult = z.infer<typeof UnlockResult>;
export const SecretsPutRoute = defineRoute({
  id: 'ai-gateway.secrets.put',
  ifId: 'IF-AI-030',
  method: 'PUT',
  path: '/internal/v1/secrets/{provider_id}',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: PutSecretBody },
  response: { 200: SecretMeta },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004', 'FR-SET-008', 'FR-AI-022'],
});
export const SecretsListRoute = defineRoute({
  id: 'ai-gateway.secrets.list',
  ifId: 'IF-AI-031',
  method: 'GET',
  path: '/internal/v1/secrets',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SecretList },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
export const SecretsDeleteRoute = defineRoute({
  id: 'ai-gateway.secrets.delete',
  ifId: 'IF-AI-032',
  method: 'DELETE',
  path: '/internal/v1/secrets/{provider_id}',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }) },
  response: { 204: z.null() },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
export const SecretsUnlockRoute = defineRoute({
  id: 'ai-gateway.secrets.unlock',
  ifId: 'IF-AI-033',
  method: 'POST',
  path: '/internal/v1/secrets:unlock',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: UnlockSecretsBody },
  response: { 200: UnlockResult },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
export const AI_SECRETS_ROUTES = [SecretsPutRoute, SecretsListRoute, SecretsDeleteRoute, SecretsUnlockRoute] as const;
