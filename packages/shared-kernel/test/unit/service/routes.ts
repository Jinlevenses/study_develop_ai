import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { z } from 'zod';
import { AppError } from '../../../src/errors/errors.js';
import type { ServiceDefinition } from '../../../src/service/types.js';

// 파이프라인 단위 테스트용 라우트 fixture(content 서비스 모양).
const base = { ifId: 'IF-CT-001', paginated: false, freeze: 'O', slice: 'R0', fr: [] } as const;

export const EchoRoute = defineRoute({
  ...base,
  id: 'content.test.echo',
  method: 'POST',
  path: '/internal/v1/test/echo',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  request: { body: S({ name: z.string().min(1), n: z.number().int().default(1) }) },
  response: { 200: S({ name: z.string(), n: z.number().int() }) },
});
export const ItemRoute = defineRoute({
  ...base,
  id: 'content.test.item',
  method: 'GET',
  path: '/internal/v1/items/{id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { params: S({ id: z.string().max(200) }), query: S({ q: z.string().optional() }) },
  response: { 200: S({ id: z.string(), q: z.string().nullable() }) },
});
export const SelectRoute = defineRoute({
  ...base,
  id: 'content.test.select',
  method: 'POST',
  path: '/internal/v1/items:select',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { body: S({ ids: z.array(z.string()) }) },
  response: { 200: S({ count: z.number().int() }) },
});
export const DeadlineRoute = defineRoute({
  ...base,
  id: 'content.test.deadline',
  method: 'GET',
  path: '/internal/v1/test/deadline',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: {},
  deadlineMs: 750,
  response: {
    200: S({ deadline_at: z.number().int(), request_id: z.string(), traceparent: z.string(), caller: z.string() }),
  },
});
export const BadResponseRoute = defineRoute({
  ...base,
  id: 'content.test.bad_response',
  method: 'GET',
  path: '/internal/v1/test/bad-response',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: {},
  response: { 200: S({ ok: z.literal(true) }) },
});
export const ThrowRoute = defineRoute({
  ...base,
  id: 'content.test.throw',
  method: 'GET',
  path: '/internal/v1/test/throw/{kind}',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { params: S({ kind: z.string() }) },
  response: { 200: S({ ok: z.literal(true) }) },
});
export const PutRoute = defineRoute({
  ...base,
  id: 'content.test.put',
  method: 'POST',
  path: '/internal/v1/test/put',
  allowedCallers: ['gateway'],
  idempotent: true,
  request: { body: S({ v: z.number().int(), mode: z.enum(['ok', 'conflict', 'boom', 'slow']).default('ok') }) },
  response: { 201: S({ v: z.number().int(), n: z.number().int() }) },
});
export const NoContentRoute = defineRoute({
  ...base,
  id: 'content.test.no_content',
  method: 'POST',
  path: '/internal/v1/test/no-content',
  allowedCallers: ['gateway'],
  idempotent: true,
  request: { body: S({ v: z.number().int() }) },
  response: { 204: z.undefined() },
});
export const NdjsonInRoute = defineRoute({
  ...base,
  id: 'content.test.ndjson_in',
  method: 'POST',
  path: '/internal/v1/test/ndjson-in',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { bodyKind: 'ndjson' },
  response: { 200: S({ lines: z.number().int() }) },
});
export const NdjsonOutRoute = defineRoute({
  ...base,
  id: 'content.test.ndjson_out',
  method: 'GET',
  path: '/internal/v1/test/ndjson-out',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: {},
  responseKind: 'ndjson',
  response: { 200: z.string() },
});
export const PublicRoute = defineRoute({
  ...base,
  ifId: 'IF-GW-001',
  id: 'gateway.test.public',
  method: 'GET',
  path: '/api/v1/test/public',
  allowedCallers: ['browser', 'cli'],
  idempotent: false,
  request: {},
  response: { 200: S({ caller: z.string() }) },
});

export type Probes = { puts: number; slowRelease: (() => void) | null; slowStarted: Promise<void> | null };

/** 라우트 fixture를 등록하는 def. `probes`로 핸들러 호출 횟수를 관찰한다. */
export function fixtureDef(
  def: ServiceDefinition<null>,
  probes: Probes = { puts: 0, slowRelease: null, slowStarted: null },
): ServiceDefinition<null> {
  return {
    ...def,
    register: (app) => {
      app.route(EchoRoute, (ctx) => Promise.resolve({ status: 200, body: { name: ctx.body.name, n: ctx.body.n } }));
      app.route(ItemRoute, (ctx) =>
        Promise.resolve({ status: 200, body: { id: ctx.params.id, q: ctx.query.q ?? null } }),
      );
      app.route(SelectRoute, (ctx) => Promise.resolve({ status: 200, body: { count: ctx.body.ids.length } }));
      app.route(DeadlineRoute, (ctx) =>
        Promise.resolve({
          status: 200,
          body: {
            deadline_at: ctx.deadlineAt,
            request_id: ctx.requestId,
            traceparent: ctx.traceparent,
            caller: ctx.caller,
          },
        }),
      );
      app.route(BadResponseRoute, () => Promise.resolve({ status: 200, body: { ok: false } }));
      app.route(ThrowRoute, (ctx) => {
        if (ctx.params.kind === 'app4xx') {
          throw new AppError('CT-NOTFOUND-900', 404, '없는 것을 찾았다 /home/u/secret.ts');
        }
        if (ctx.params.kind === 'unregistered') {
          throw new AppError('CT-LIMIT-777', 413, 'x');
        }
        if (ctx.params.kind === 'plain') {
          throw new AppError('CT-VAL-900', 400, '값이 이상하다');
        }
        throw new Error(
          'db at /home/u/x.ts failed: SELECT * FROM t\n    at fn (/home/u/x.ts:1:1)\n    at C:\\Users\\u\\y.ts',
        );
      });
      app.route(PutRoute, async (ctx) => {
        probes.puts += 1;
        if (ctx.body.mode === 'conflict') {
          throw new AppError('CT-CONFLICT-001', 422, '충돌');
        }
        if (ctx.body.mode === 'boom') {
          throw new Error('boom');
        }
        if (ctx.body.mode === 'slow') {
          await new Promise<void>((resolve) => {
            probes.slowRelease = resolve;
          });
        }
        return { status: 201, body: { v: ctx.body.v, n: probes.puts } };
      });
      app.route(NoContentRoute, () => Promise.resolve({ status: 204, body: undefined }));
      app.stream(NdjsonInRoute, async (ctx, reply) => {
        const stream: unknown = ctx.raw.body;
        let text = '';
        if (typeof stream === 'object' && stream !== null && Symbol.asyncIterator in stream) {
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            text += chunk.toString('utf8');
          }
        }
        await reply
          .type('application/json; charset=utf-8')
          .send(JSON.stringify({ lines: text.split('\n').filter((l) => l !== '').length }));
      });
      app.stream(NdjsonOutRoute, async (_ctx, reply) => {
        await reply.type('application/x-ndjson').send('{"a":1}\n{"a":2}\n');
      });
    },
  };
}
