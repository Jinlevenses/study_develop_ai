import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { HashPort } from '../../domain/ledger/chain/hash.js';

/** domain/ledger가 주입받는 해시 포트의 실구현(정준 JSON NFR-DATA-002 + SHA-256 hex 64). */
export const NODE_HASH_PORT: HashPort = { canonical: canonicalJson, sha256: (s) => sha256Hex(s) };
