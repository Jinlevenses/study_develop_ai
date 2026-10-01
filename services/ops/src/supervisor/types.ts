import type { AllowedEnvName } from '@fathom/shared-kernel/config/config';
import type { Logger, LogLevel } from '@fathom/shared-kernel/log/log';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { BundleInfo, EntryOverrides } from './bundle.js';
import type { SpawnChild } from './child.js';
import type { DevWatchFactory, Timers } from './dev-watch.js';
import type { LogSink } from './log-sink.js';
import type { StatusRow } from './process-table.js';
import type { RuntimeFilesPort } from './runtime-files.js';

// Brief T-00-11 §4.1.8 — supervisor 공개 타입(`bootId` = 잠금·registry·로거가 공유하는 이 boot의 ID, Brief 필드에 가산).
export type SupervisorOptions = {
  readonly profile: 'prod' | 'dev' | 'test';
  readonly home: string;
  readonly bundle: BundleInfo;
  readonly bootId: string;
  readonly safeMode: boolean;
  readonly foreground: boolean;
  readonly logLevel: LogLevel;
  readonly entries: EntryOverrides;
  readonly previousCrashed: boolean;
};
export type SupervisorDeps = {
  readonly clock: Clock;
  readonly timers: Timers;
  readonly spawnChild: SpawnChild;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly files: RuntimeFilesPort;
  readonly sink: LogSink;
  readonly log: Logger;
  readonly env: (n: AllowedEnvName) => string | undefined;
  readonly platform: NodeJS.Platform;
  readonly watch?: DevWatchFactory;
  readonly probeTcp?: (port: number) => Promise<boolean>;
};
export interface Supervisor {
  start(): Promise<void>;
  shutdownAll(graceMs: number): Promise<void>;
  statusRows(): readonly StatusRow[];
  setLogLevel(level: LogLevel): void;
  readonly done: Promise<number>;
}
