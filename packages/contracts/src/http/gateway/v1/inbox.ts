import { Ulid } from '../../../common/ids.js';
import { Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { CaptureInboxBody, InboxItemView, InboxListQuery, TriageInboxBody } from '../../content/v1/acquisition.js';

// 하위 = IF-CT-036
export const InboxListRoute = defineRoute({
  id: 'gateway.inbox.list',
  ifId: 'IF-GW-085',
  method: 'GET',
  path: '/api/v1/inbox',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: InboxListQuery },
  response: { 200: Page(InboxItemView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-013', 'FR-IMP-014'],
});
// idem = inbox_id
// 하위 = IF-CT-035
export const InboxCaptureRoute = defineRoute({
  id: 'gateway.inbox.capture',
  ifId: 'IF-GW-086',
  method: 'POST',
  path: '/api/v1/inbox',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: CaptureInboxBody },
  response: { 201: InboxItemView },
  bodyLimitBytes: 4_194_304,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-013'],
});
// 하위 = IF-CT-037
export const InboxTriageRoute = defineRoute({
  id: 'gateway.inbox.triage',
  ifId: 'IF-GW-087',
  method: 'POST',
  path: '/api/v1/inbox/{inbox_id}:triage',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ inbox_id: Ulid }), body: TriageInboxBody },
  response: { 200: InboxItemView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-014'],
});
export const GW_INBOX_ROUTES = [InboxListRoute, InboxCaptureRoute, InboxTriageRoute] as const;
