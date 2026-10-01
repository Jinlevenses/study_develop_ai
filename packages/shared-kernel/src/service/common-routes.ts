import type { Readyz } from '@fathom/contracts/admin/admin-routes';
import { HealthLiveRoute, HealthReadyRoute, MetricsGetRoute } from '@fathom/contracts/admin/admin-routes';
import { ServiceName } from '@fathom/contracts/common/ids';
import { InboxDeliverRoute } from '@fathom/contracts/events/inbox';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { InboxProcessor } from '../eventing/inbox.js';
import type { Relay } from '../eventing/relay.js';
import { appErrorCode } from './problem.js';
import type { EventLoopProbe } from './process-port.js';
import { readRssBytes } from './process-port.js';
import type { ServiceState } from './service-state.js';
import type { ServiceApp, ServiceDefinitionBase } from './types.js';

// §4.6 공통 라우트(IF-COM-001~004) — healthz · readyz · metrics · inbox.

export type CommonRouteDeps = {
  readonly def: ServiceDefinitionBase;
  readonly app: ServiceApp;
  readonly state: ServiceState;
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
  readonly bootId: string;
  readonly appVersion: string;
  readonly startedAt: number;
  readonly peerMissing: () => readonly ServiceName[];
  readonly relay: Pick<Relay, 'collectGauges'> | null;
  readonly probe: EventLoopProbe;
  readonly inbox: InboxProcessor | null;
};

function attemptOf(header: string | string[] | undefined): number {
  const text = Array.isArray(header) ? header[0] : header;
  if (text === undefined || !/^\d{1,9}$/.test(text)) {
    return 1;
  }
  return Math.max(1, Number(text));
}

function readyzBody(d: CommonRouteDeps): { ready: boolean; body: Readyz } {
  const missing = d.peerMissing();
  const peersOk = missing.length === 0;
  const reasons: string[] = [];
  if (!d.state.ready) {
    reasons.push('starting');
  }
  for (const peer of missing) {
    reasons.push(`peer_missing:${peer}`);
  }
  if (d.state.integrity === 'failed') {
    const files = d.state.integrityFailedFiles;
    reasons.push(...(files.length === 0 ? ['integrity_failed'] : files.map((f) => `integrity_failed:${f}`)));
  }
  // integrity는 보고만 한다 — `pending`이 ready를 막지 않는다 [Brief 결정].
  const ready = d.state.ready && peersOk;
  return {
    ready,
    body: {
      ready,
      svc: d.def.svc,
      checks: {
        db: d.state.ready,
        schema: d.state.ready,
        policy: d.state.ready,
        peers: peersOk,
        integrity: d.state.integrity,
      },
      reasons: reasons.slice(0, 20),
    },
  };
}

export function registerCommonRoutes(d: CommonRouteDeps): void {
  const rss = d.metrics.gauge('process_resident_memory_bytes', '프로세스 상주 메모리(bytes)');
  const loop = d.metrics.gauge('eventloop_delay_p99_ms', '이벤트 루프 지연 p99(ms)');

  d.app.route(HealthLiveRoute, () =>
    Promise.resolve({
      status: 200,
      body: {
        ok: true,
        svc: d.def.svc,
        version: d.appVersion,
        boot_id: d.bootId,
        uptime_ms: Math.max(0, d.clock.now() - d.startedAt),
      },
    }),
  );

  d.app.route(HealthReadyRoute, () => {
    const r = readyzBody(d);
    return Promise.resolve({ status: r.ready ? 200 : 503, body: r.body });
  });

  d.app.route(MetricsGetRoute, () => {
    d.relay?.collectGauges();
    rss.set(readRssBytes());
    loop.set(d.probe.p99Ms());
    return Promise.resolve({ status: 200, body: d.metrics.render() });
  });

  const inbox = d.inbox;
  if (inbox === null) {
    return;
  }
  d.app.route(InboxDeliverRoute, async (ctx) => {
    const caller = ServiceName.safeParse(ctx.caller);
    if (!caller.success) {
      throw new AppError(appErrorCode(d.def.svc, 'ACL-900'), 403, '허용되지 않은 호출자다.');
    }
    const out = await inbox.process(caller.data, ctx.body, attemptOf(ctx.raw.headers['x-fathom-delivery-attempt']));
    switch (out.kind) {
      case 'ack':
        return { status: 200, body: { acked_through_seq: out.acked_through_seq } };
      case 'halt':
        throw new AppError(appErrorCode(d.def.svc, 'DEP-910'), 503, 'inbox 원장 경로가 정지했다.', {
          extra: { acked_through_seq: out.acked_through_seq },
        });
      case 'reject':
        if (out.reason === 'producer_mismatch') {
          throw new AppError(appErrorCode(d.def.svc, 'ACL-900'), 403, '호출자와 producer가 다르다.');
        }
        throw new AppError(appErrorCode(d.def.svc, 'VAL-900'), 400, 'producer_seq가 엄격 증가하지 않는다.', {
          extra: {
            errors: [{ path: 'events', message: 'producer_seq는 엄격 증가여야 한다', rule: 'producer_seq_order' }],
          },
        });
    }
  });
}
