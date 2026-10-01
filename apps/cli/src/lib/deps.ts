import type { AllowedEnvName } from '@fathom/shared-kernel/config/config';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { GatewayClient } from './gateway-client.js';
import type { Writer } from './output.js';

// Brief §4.2.1 — 테스트는 전부 주입한다. 진짜 구현은 real-deps.ts.
export type LaunchOptions = {
  readonly appRoot: string;
  readonly runtime: 'src' | 'dist';
  readonly profile: 'prod' | 'dev' | 'test';
  readonly home: string;
  readonly safe: boolean;
  readonly foreground: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly entries: string | null;
};
export type Launched = { readonly pid: number; readonly exited: Promise<number | null> };

export type CliDeps = {
  readonly stdout: Writer;
  readonly stderr: Writer;
  readonly env: (name: AllowedEnvName) => string | undefined;
  readonly platform: NodeJS.Platform;
  readonly clock: Clock;
  readonly appRoot: string;
  readonly runtime: 'src' | 'dist';
  readonly nodeVersion: string;
  /** supervisor를 파일 경로로 spawn한다(import 0). 실패는 던진다. */
  launchSupervisor(opts: LaunchOptions): Launched;
  isAlive(pid: number): boolean;
  /** 파일이 없으면 null. */
  readText(path: string): Promise<string | null>;
  mkdirp(dir: string, mode: number): Promise<void>;
  gateway(port: number, token: string, appVersion: string): GatewayClient;
  openBrowser(url: string, home: string): Promise<boolean>;
  /** 종료 신호(POSIX SIGTERM / win32 `taskkill /PID`). 보냈으면 true. */
  killPid(pid: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
};
