import { z } from 'zod';
import { ProviderId } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const PutSecretBody = S({ secret: z.string().min(8).max(4096), store: z.enum(['auto', 'keychain', 'file']), verify: z.boolean() });
export type PutSecretBody = z.infer<typeof PutSecretBody>;
export const SecretMeta = S({ provider_id: ProviderId, source: z.enum(['keychain', 'file', 'env']), last4: z.string().length(4), verified_at: EpochMs.nullable() });
export type SecretMeta = z.infer<typeof SecretMeta>;
export const SecretList = S({ secrets: z.array(SecretMeta).max(16),
  store: S({ backend: z.enum(['keychain', 'file', 'env_only']), locked: z.boolean(), kek_kind: z.enum(['os', 'passphrase']).nullable() }) });
export type SecretList = z.infer<typeof SecretList>;
export const UnlockSecretsBody = S({ passphrase: z.string().min(12).max(1024) });                 // scrypt(N=2^17,r=8,p=1,maxmem=256MiB)
export type UnlockSecretsBody = z.infer<typeof UnlockSecretsBody>;
export const UnlockResult = S({ unlocked: z.boolean(), providers: z.array(ProviderId) });
export type UnlockResult = z.infer<typeof UnlockResult>;
