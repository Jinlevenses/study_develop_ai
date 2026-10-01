import { z } from 'zod';
import { RuntimeProfile } from '../../../common/domain.js';
import { SemVer, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/); // 32B base64url(패딩 없음)
export type Base64Url32 = z.infer<typeof Base64Url32>;
export const BootstrapTokenRequest = S({ purpose: z.enum(['up', 'open']) });
export type BootstrapTokenRequest = z.infer<typeof BootstrapTokenRequest>;
export const BootstrapTokenResponse = S({
  bootstrap_token: Base64Url32,
  expires_at: EpochMs,
  open_url: z.string().url(),
}); // 'http://127.0.0.1:<port>/#bt=<token>'
export type BootstrapTokenResponse = z.infer<typeof BootstrapTokenResponse>;
export const ExchangeRequest = S({ bt: Base64Url32 });
export type ExchangeRequest = z.infer<typeof ExchangeRequest>;
export const ExchangeResponse = S({
  session_established: z.literal(true),
  port: z.number().int().min(1).max(65535),
  app_version: SemVer,
  profile: RuntimeProfile,
});
export type ExchangeResponse = z.infer<typeof ExchangeResponse>;
//   Set-Cookie: fathom_sid=v1.<sid>.<port>.<iat>.<mac>; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000
export const CsrfResponse = S({ csrf: Base64Url32 });
export type CsrfResponse = z.infer<typeof CsrfResponse>;
export const SessionStatus = S({
  authenticated: z.literal(true),
  port: z.number().int(),
  app_version: SemVer,
  boot_id: Ulid,
  profile: RuntimeProfile,
  safe_mode: z.boolean(),
  maintenance: z.enum(['none', 'restore', 'upgrade']),
});
export type SessionStatus = z.infer<typeof SessionStatus>;
export const SessionExchangeRoute = defineRoute({
  id: 'gateway.session.exchange',
  ifId: 'IF-GW-002',
  method: 'POST',
  path: '/api/v1/session/exchange',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { body: ExchangeRequest },
  response: { 200: ExchangeResponse },
  freeze: 'D',
  slice: 'R0',
  fr: ['NFR-SEC-019'],
});
export const SessionCsrfRoute = defineRoute({
  id: 'gateway.session.csrf',
  ifId: 'IF-GW-003',
  method: 'GET',
  path: '/api/v1/session/csrf',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: CsrfResponse },
  freeze: 'D',
  slice: 'R0',
  fr: ['NFR-SEC-002'],
});
export const SessionLogoutRoute = defineRoute({
  id: 'gateway.session.logout',
  ifId: 'IF-GW-004',
  method: 'POST',
  path: '/api/v1/session/logout',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 204: z.null() },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-SEC-019'],
});
export const SessionStatusRoute = defineRoute({
  id: 'gateway.session.status',
  ifId: 'IF-GW-006',
  method: 'GET',
  path: '/api/v1/session',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SessionStatus },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-023'],
});
export const GW_SESSION_ROUTES = [
  SessionExchangeRoute,
  SessionCsrfRoute,
  SessionLogoutRoute,
  SessionStatusRoute,
] as const;
