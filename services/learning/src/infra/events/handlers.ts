import type { InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';

// application/<bc>/inbox/<event>.ts 핸들러 목록 — 서비스 결선 WP가 채운다. IT-00 = 0개(구독 이벤트는 HANDLER-MISSING 독 이벤트: halt 경로는 정지, dead_letter는 격리 — 유실 0, T-00-08 §4.1.4).
export const INBOX_HANDLERS: readonly InboxHandlerDef[] = [];
