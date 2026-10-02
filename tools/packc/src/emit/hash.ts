// 레코드 해시 규칙(Brief T-01-03 §4.8-1 · §4.5): content_hash = sha256(canonicalJson(레코드 − content_hash)),
// subject hash(V7 바인딩) = sha256(canonicalJson(레코드 − {content_hash, gate_status, s2_mode}))(item 외 kind는 content_hash와 같다).
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';

export type Rec = { readonly [key: string]: unknown };

function without(rec: Rec, drop: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rec)) {
    if (!drop.includes(key)) {
      out[key] = rec[key];
    }
  }
  return out;
}

export function contentHash(rec: Rec): string {
  return sha256Hex(canonicalJson(without(rec, ['content_hash'])));
}

export function subjectHash(rec: Rec): string {
  return sha256Hex(canonicalJson(without(rec, ['content_hash', 'gate_status', 's2_mode'])));
}
