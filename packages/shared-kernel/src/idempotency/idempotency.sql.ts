// IF-01 §2.7 — `idem_request`(DB-01 §4, `_infra` 0003) 운영 SQL. [Brief 결정] 가산분. UPSERT 금지(STD-SQL-11) — DELETE + INSERT.

/** [Brief 결정] IDEM_GET */
export const IDEM_GET = `SELECT request_hash, status, response_json, created_at FROM idem_request
WHERE key = :key AND caller = :caller AND route_id = :route_id`;

/** [Brief 결정] IDEM_DELETE: 같은 PK(만료 행 제거) */
export const IDEM_DELETE = `DELETE FROM idem_request WHERE key = :key AND caller = :caller AND route_id = :route_id`;

/** [Brief 결정] IDEM_INSERT */
export const IDEM_INSERT = `INSERT INTO idem_request(key, caller, route_id, request_hash, status, response_json, created_at)
VALUES (:key, :caller, :route_id, :request_hash, :status, :response_json, :created_at)`;
