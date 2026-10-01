import type { ServiceName } from '@fathom/contracts/common/ids';
import type { Problem } from '@fathom/contracts/common/problem';
import type { RouteDef } from '@fathom/contracts/common/route';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { z } from 'zod';

// T-00-04 `http-client.ts`와 같은 타입 모양(Brief §4.2.3 — 글자 그대로).
export type PeerInput = {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: unknown;
};
export type PeerCallOptions = {
  readonly idempotencyKey?: string;
  readonly deadlineAt?: number;
  readonly requestId?: string;
  readonly traceparent?: string | null;
};
export type PeerFailure =
  | {
      readonly kind: 'connect_failed' | 'connect_timeout' | 'circuit_open' | 'deadline_exhausted' | 'timeout';
      readonly dependency: ServiceName;
    }
  | { readonly kind: 'problem'; readonly dependency: ServiceName; readonly status: number; readonly problem: Problem }
  | {
      readonly kind: 'contract_violation';
      readonly dependency: ServiceName;
      readonly status: number;
      readonly detail: string;
    };
/**
 * [Brief §4.3 deviation, T-00-03 supplement] 라우트 객체의 `response[status]`는 런타임에 고른 스키마라 출력 타입이 합집합으로만 보인다.
 * `safeParse`를 통과한 값이므로 호출자가 정한 라우트 리터럴 타입 `ResponseOf<R>`로 좁히는 단언은 이 함수 한 곳에만 둔다.
 */
function narrowParsedResponse<R extends RouteDef>(parsed: unknown): ResponseOf<R> {
  return parsed as ResponseOf<R>;
}

export type ResponseOf<R extends RouteDef> = z.output<R['response'][keyof R['response'] & number]>;
export type PeerSuccess<T = unknown> = { readonly status: number; readonly body: T; readonly replayed: boolean };
export interface PeerClientPort {
  call<R extends RouteDef>(
    route: R,
    input: PeerInput,
    opts?: PeerCallOptions,
  ): Promise<Result<PeerSuccess<ResponseOf<R>>, PeerFailure>>;
}

export type FakeHandler = (input: PeerInput) => Result<PeerSuccess, PeerFailure>;

export type FakeCall = {
  readonly route_id: string;
  readonly input: PeerInput;
  readonly idempotency_key: string | null;
  /** IF-01 §2.9: `deadlineAt − now − 10`. `deadlineAt`이 없으면 null. */
  readonly deadline_header_ms: number | null;
  readonly request_id: string | null;
};

export type FakePeer = PeerClientPort & { readonly calls: readonly FakeCall[] };

const NETWORK_MARGIN_MS = 10; // IF-01 §2.9 하위 호출 헤더 = deadline_at − now − 10

/** 피어 서비스 fake. 호출을 기록하고, 실 PeerClient와 같은 데드라인·멱등·응답 검증 규칙을 따른다. */
export function createFakePeer(opts: {
  peer: ServiceName;
  clock: Clock;
  handlers: Readonly<Record<string, FakeHandler>>;
}): FakePeer {
  const { peer, clock, handlers } = opts;
  const recorded: FakeCall[] = [];

  return {
    get calls(): readonly FakeCall[] {
      return [...recorded];
    },
    call<R extends RouteDef>(
      route: R,
      input: PeerInput,
      callOpts?: PeerCallOptions,
    ): Promise<Result<PeerSuccess<ResponseOf<R>>, PeerFailure>> {
      if (route.idempotent && callOpts?.idempotencyKey === undefined) {
        return Promise.reject(new Error(`invariant: idempotent route ${route.id} called without idempotencyKey`));
      }
      const deadlineHeader =
        callOpts?.deadlineAt === undefined ? null : callOpts.deadlineAt - clock.now() - NETWORK_MARGIN_MS;
      recorded.push({
        route_id: route.id,
        input,
        idempotency_key: callOpts?.idempotencyKey ?? null,
        deadline_header_ms: deadlineHeader,
        request_id: callOpts?.requestId ?? null,
      });
      if (deadlineHeader !== null && deadlineHeader <= 0) {
        return Promise.resolve(err({ kind: 'deadline_exhausted', dependency: peer }));
      }
      const handler = handlers[route.id];
      if (handler === undefined) {
        return Promise.reject(new Error(`invariant: no fake handler for ${route.id}`));
      }
      const outcome = handler(input);
      if (!outcome.ok) {
        return Promise.resolve(outcome);
      }
      const { status, body, replayed } = outcome.value;
      const schema = route.response[status];
      if (schema === undefined) {
        return Promise.resolve(
          err({ kind: 'contract_violation', dependency: peer, status, detail: `status ${status} not declared` }),
        );
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(
          err({ kind: 'contract_violation', dependency: peer, status, detail: parsed.error.message }),
        );
      }
      return Promise.resolve(ok({ status, body: narrowParsedResponse<R>(parsed.data), replayed }));
    },
  };
}
