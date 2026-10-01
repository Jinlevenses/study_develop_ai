import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Relay } from '../eventing/relay.js';
import type { ProcessPort } from './process-port.js';
import type { ServiceState } from './service-state.js';

// serve 흐름이 단계 사이에 주고받는 값. 실패는 `Failure`(종료 코드 + 짧은 사유 코드)로 올리고 `serve()`가 한 곳에서 `fatal`로 바꾼다.

export type ExitCode = 64 | 70 | 75 | 78;
export type Failure = { readonly exit: ExitCode; readonly code: string };
export type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

export const stepOk = <T>(value: T): Step<T> => ({ ok: true, value });
export const stepFail = (exit: ExitCode, code: string): Step<never> => ({ ok: false, failure: { exit, code } });

export type OpenedDatabases = {
  readonly dbs: Record<string, SqlitePort>;
  readonly schemaVersions: Record<string, Record<string, number>>;
  readonly quickFailed: string[];
  readonly fullDb: SqlitePort | null;
};

/** 기동 중·서비스 중 바뀌는 값(피어 URL·relay·quiesce 일시정지·종료 함수) — 서비스당 1개, serve()가 만든다. */
export type ServeRuntime = {
  relay: Relay | null;
  paused: boolean;
  peerUrls: Partial<Record<ServiceName, { url: string }>>;
  shutdown: (graceMs: number) => Promise<void>;
};

export type BootContext = {
  readonly port: ProcessPort;
  readonly env: BootstrapEnvelope;
  readonly logger: Logger;
  readonly state: ServiceState;
};
