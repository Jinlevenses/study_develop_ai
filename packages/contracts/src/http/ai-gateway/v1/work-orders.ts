import { z } from 'zod';
import { CreateWorkOrderBody, DecideWorkOrderBody, WorkOrderView } from '../../../ai/work-order.js';
import { Ulid } from '../../../common/ids.js';
import { Cursor, Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';

export const WorkOrderListQuery = S({
  state: WorkOrderView.shape.state.optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type WorkOrderListQuery = z.infer<typeof WorkOrderListQuery>;

// idem = work_order_id
export const WorkOrdersCreateRoute = defineRoute({
  id: 'ai-gateway.work_orders.create',
  ifId: 'IF-AI-020',
  method: 'POST',
  path: '/internal/v1/work-orders',
  allowedCallers: ['content'],
  idempotent: true,
  paginated: false,
  request: { body: CreateWorkOrderBody },
  response: { 201: WorkOrderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007', 'FR-AI-025', 'FR-AI-026'],
});
export const WorkOrdersListRoute = defineRoute({
  id: 'ai-gateway.work_orders.list',
  ifId: 'IF-AI-021',
  method: 'GET',
  path: '/internal/v1/work-orders',
  allowedCallers: ['gateway', 'content'],
  idempotent: false,
  paginated: true,
  request: { query: WorkOrderListQuery },
  response: { 200: Page(WorkOrderView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-026'],
});
export const WorkOrdersDecideRoute = defineRoute({
  id: 'ai-gateway.work_orders.decide',
  ifId: 'IF-AI-022',
  method: 'POST',
  path: '/internal/v1/work-orders/{work_order_id}:decide',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ work_order_id: Ulid }), body: DecideWorkOrderBody },
  response: { 200: WorkOrderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-026'],
});
export const WorkOrdersGetRoute = defineRoute({
  id: 'ai-gateway.work_orders.get',
  ifId: 'IF-AI-023',
  method: 'GET',
  path: '/internal/v1/work-orders/{work_order_id}',
  allowedCallers: ['gateway', 'content'],
  idempotent: false,
  paginated: false,
  request: { params: S({ work_order_id: Ulid }) },
  response: { 200: WorkOrderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-026'],
});
export const AI_WORK_ORDERS_ROUTES = [
  WorkOrdersCreateRoute,
  WorkOrdersListRoute,
  WorkOrdersDecideRoute,
  WorkOrdersGetRoute,
] as const;
