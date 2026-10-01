import type { CallerName } from '@fathom/contracts/common/ids';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { IDEM_DELETE, IDEM_GET, IDEM_INSERT } from './idempotency.sql.js';

// IF-01 §2.7 · STD-API-30·31 — HTTP 멱등 저장소. 저장 키 = (key, caller, route_id), 보관 7일.

export type IdemScope = { readonly key: string; readonly caller: CallerName; readonly routeId: string };
export type IdemBegin =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'replay'; readonly status: number; readonly responseJson: string }
  | { readonly kind: 'conflict_body' }
  | { readonly kind: 'in_flight' };
export interface IdempotencyStore {
  /** 동기. in-flight → 저장된 행(만료 아님) → 없음/만료 순으로 본다. */
  begin(scope: IdemScope, requestHash: string): IdemBegin;
  /** status < 500만 저장한다. in-flight는 항상 해제한다. */
  complete(scope: IdemScope, requestHash: string, status: number, responseJson: string): void;
  /** in-flight 해제만(5xx·예외). */
  abandon(scope: IdemScope): void;
}

const DEFAULT_TTL_MS = 7 * 86_400_000;
const SEP = '\u0000';

/** 요청 해시 = sha256(canonicalJson(zod 파싱 후 body)). body가 없으면 `null`. */
export function requestHash(body: unknown): string {
  return sha256Hex(canonicalJson(body === undefined ? null : body));
}

/**
 * in-flight = 이 저장소 객체 안의 `Map`. composition root가 서비스당 1개 만든다(STD-TS-16).
 * `db === null`(gateway)이면 저장 없이 in-flight만 추적한다.
 */
export function createIdempotencyStore(opts: {
  readonly db: SqlitePort | null;
  readonly clock: Clock;
  readonly ttlMs?: number;
}): IdempotencyStore {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const inFlight = new Set<string>();
  const keyOf = (s: IdemScope): string => `${s.key}${SEP}${s.caller}${SEP}${s.routeId}`;
  const names = (s: IdemScope): { key: string; caller: string; route_id: string } => ({
    key: s.key,
    caller: s.caller,
    route_id: s.routeId,
  });

  return {
    begin(scope: IdemScope, hash: string): IdemBegin {
      const flightKey = keyOf(scope);
      if (inFlight.has(flightKey)) {
        return { kind: 'in_flight' };
      }
      if (opts.db !== null) {
        const row = opts.db.prepare(IDEM_GET).get(names(scope));
        if (row !== undefined) {
          const createdAt = Number(row.created_at);
          if (createdAt >= opts.clock.now() - ttlMs) {
            if (row.request_hash !== hash) {
              return { kind: 'conflict_body' };
            }
            return { kind: 'replay', status: Number(row.status), responseJson: String(row.response_json) };
          }
        }
      }
      inFlight.add(flightKey);
      return { kind: 'proceed' };
    },
    complete(scope: IdemScope, hash: string, status: number, responseJson: string): void {
      try {
        const db = opts.db;
        if (db !== null && status < 500) {
          db.tx(() => {
            db.prepare(IDEM_DELETE).run(names(scope));
            db.prepare(IDEM_INSERT).run({
              ...names(scope),
              request_hash: hash,
              status,
              response_json: responseJson === '' ? '{}' : responseJson,
              created_at: opts.clock.now(),
            });
          });
        }
      } finally {
        inFlight.delete(keyOf(scope));
      }
    },
    abandon(scope: IdemScope): void {
      inFlight.delete(keyOf(scope));
    },
  };
}
