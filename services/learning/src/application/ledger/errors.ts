import type { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';
import type { LedgerFaultKind } from './ports.js';

// LedgerFault.kind → 서비스 오류 코드(STD-ERR-10·14). 원장 무결성·계약 결함 신호는 전부 LR-INTERNAL-001(원장 무결성 경보).
export const LEDGER_ERROR_MAP = {
  payload_invalid: 'LR-INTERNAL-001',
  key_invalid: 'LR-INTERNAL-001',
  schema_version_unsupported: 'LR-INTERNAL-001',
  chain_conflict: 'LR-INTERNAL-001',
  check_swallowed: 'LR-INTERNAL-001',
  chain_broken: 'LR-INTERNAL-001',
  anchor_mismatch: 'LR-INTERNAL-001',
  projection_invalid: 'LR-INTERNAL-001',
} as const satisfies Readonly<Record<LedgerFaultKind, keyof typeof LR_ERRORS>>;
