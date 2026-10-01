// ARC-01 §17.3 `service` 공개 API — 진입 파일(STD-DIR-31: import + export {}, `export *` 금지).
import { assembleApp, buildServiceApp } from './app.js';
import type { CreateServiceOptions } from './boot.js';
import { createService } from './boot.js';
import { makeIntegrityJob, makeSnapshotJob } from './default-jobs.js';
import type { ParsedMode } from './modes.js';
import { parseModeArgs } from './modes.js';
import type { ProblemContext, ProblemResult } from './problem.js';
import { toProblem } from './problem.js';
import type { ProcessPort } from './process-port.js';
import { realProcessPort } from './process-port.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import { createSqliteLoader, installSqliteWarningFilter, loadSqliteRuntime } from './sqlite-loader.js';
import type {
  ModeContext,
  PublicAuthHook,
  ReqPart,
  RouteContext,
  RouteReply,
  RunningService,
  ServiceApp,
  ServiceAppHandle,
  ServiceAppRuntime,
  ServiceDatabase,
  ServiceDefinition,
  ServiceDeps,
  ServiceRunResult,
} from './types.js';
import type { WriteGate, WriteGateOptions } from './write-gate.js';
import { createWriteGate } from './write-gate.js';

export type {
  CreateServiceOptions,
  ModeContext,
  ParsedMode,
  ProblemContext,
  ProblemResult,
  ProcessPort,
  PublicAuthHook,
  ReqPart,
  RouteContext,
  RouteReply,
  RunningService,
  ServiceApp,
  ServiceAppHandle,
  ServiceAppRuntime,
  ServiceDatabase,
  ServiceDefinition,
  ServiceDeps,
  ServiceRunResult,
  SqliteRuntime,
  WriteGate,
  WriteGateOptions,
};
export {
  assembleApp,
  buildServiceApp,
  createService,
  createSqliteLoader,
  createWriteGate,
  installSqliteWarningFilter,
  loadSqliteRuntime,
  makeIntegrityJob,
  makeSnapshotJob,
  parseModeArgs,
  realProcessPort,
  toProblem,
};
