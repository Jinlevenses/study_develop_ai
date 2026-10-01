import { z } from 'zod';
import { ServiceName, Ulid } from './ids.js';
import { S } from './schema.js';

export const ErrorCode = z
  .string()
  .regex(/^(GW|CT|LR|AI|OP|CLI)-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/);
export type ErrorCode = z.infer<typeof ErrorCode>;
export const FieldError = S({ path: z.string().max(200), message: z.string().max(300), rule: z.string().max(60) });
export type FieldError = z.infer<typeof FieldError>;
export const Problem = S({
  type: z.string().regex(/^urn:fathom:problem:[a-z]+-[a-z]+-\d{3}$/), // 'urn:fathom:problem:lr-dep-001' (= code 소문자)
  title: z.string().max(120), // 고정 문구(코드별, 한국어)
  status: z.number().int().min(400).max(599),
  detail: z.string().max(1000).optional(), // 사용자 표시 가능 문구. 스택·경로·SQL 0 (NFR-SEC-012)
  instance: z.string().max(300).optional(), // 요청 경로
  code: ErrorCode,
  error_id: Ulid, // 로그와 연결(로그에만 상세)
  request_id: Ulid,
  retryable: z.boolean(),
  retry_after_ms: z.number().int().min(0).optional(),
  errors: z.array(FieldError).max(50).optional(), // VAL 계열만
  dependency: ServiceName.optional(), // DEP 계열: 실패한 하위 서비스
  acked_through_seq: z.number().int().min(0).optional(), // inbox halt(§3.3)만
  active_session_id: Ulid.optional(), // LR-CONFLICT-011만
  violations: z.array(z.record(z.string(), z.unknown())).max(100).optional(), // 검증 위반 목록(원장 import·팩 검증)
});
export type Problem = z.infer<typeof Problem>;
