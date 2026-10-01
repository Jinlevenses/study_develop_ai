import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { BundleInfo } from './bundle.js';

// ADR-012 §6 — 혼합 버전 기동 거부. `schema_versions`·`app_version`은 기록만(스키마 불일치는 서비스가 exit 78).
export type ReadyInfo = {
  readonly contracts_hash: string;
  readonly schema_versions: Readonly<Record<string, unknown>>;
  readonly app_version: string;
};

export function checkHandshake(
  ready: ReadyInfo,
  bundle: Pick<BundleInfo, 'contractsHash'>,
): Result<null, { reason: 'contracts_hash_mismatch'; expected: string; actual: string }> {
  if (ready.contracts_hash !== bundle.contractsHash) {
    return err({ reason: 'contracts_hash_mismatch', expected: bundle.contractsHash, actual: ready.contracts_hash });
  }
  return ok(null);
}
