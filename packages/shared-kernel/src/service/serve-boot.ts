import { existsSync } from 'node:fs';
import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { IpcSupervisorToService } from '@fathom/contracts/admin/ipc';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { infraMigrationsDir } from './infra-dir.js';
import type { IpcInbox } from './ipc-inbox.js';
import { APP_ID_GET, QUICK_CHECK } from './maintenance.sql.js';
import type { ProcessPort } from './process-port.js';
import type { OpenedDatabases, Step } from './serve-types.js';
import { stepFail, stepOk } from './serve-types.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import type { ServiceDefinitionBase } from './types.js';

// serve 1~6단계 — 부트스트랩 봉투 수신·환경 검사·DB 열기·정책. 부트스트랩 봉투(토큰)는 로그·예외 메시지에 싣지 않는다.

export const LISTEN_HOST = '127.0.0.1';
const BOOTSTRAP_TIMEOUT_MS = 10_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 첫 메시지를 10s 기다려 `BootstrapEnvelope`로 검증한다. */
export async function receiveEnvelope(def: ServiceDefinitionBase, ipc: IpcInbox): Promise<Step<BootstrapEnvelope>> {
  const first = await ipc.first(BOOTSTRAP_TIMEOUT_MS);
  if (first.kind === 'timeout') {
    return stepFail(78, 'bootstrap_timeout');
  }
  if (first.kind === 'disconnected') {
    return stepFail(78, 'bootstrap_disconnected');
  }
  const raw = first.value;
  if (!isRecord(raw) || raw.type !== 'bootstrap') {
    return stepFail(78, 'bootstrap_unexpected');
  }
  if (isRecord(raw.listen) && raw.listen.host !== LISTEN_HOST) {
    return stepFail(78, 'listen_host_forbidden');
  }
  const parsed = IpcSupervisorToService.safeParse(raw);
  if (!parsed.success || parsed.data.type !== 'bootstrap') {
    return stepFail(78, 'bootstrap_invalid');
  }
  return parsed.data.svc === def.svc ? stepOk(parsed.data) : stepFail(78, 'bootstrap_svc_mismatch');
}

/** 환경·계약 해시 검사 [Brief 결정]: 컨테이너·외부 supervisor·운영 프로파일의 테스트 env는 지원하지 않는다. */
export function checkEnvironment(def: ServiceDefinitionBase, port: ProcessPort, env: BootstrapEnvelope): Step<null> {
  if (port.env('FATHOM_DEPLOY') !== undefined) {
    return stepFail(78, 'container_mode_unsupported');
  }
  if (port.env('FATHOM_SUPERVISOR') !== undefined) {
    return stepFail(78, 'external_supervisor_unsupported');
  }
  if (env.profile !== 'test' && port.env('FATHOM_AI_CASSETTE_DIR') !== undefined) {
    return stepFail(78, 'test_env_in_prod');
  }
  if (def.contractsHash !== null && def.contractsHash !== env.contracts_hash) {
    return stepFail(78, 'contracts_hash_mismatch');
  }
  return stepOk(null);
}

/** `PRAGMA quick_check` = 한 행 `ok`. 손상이 심해 문장 자체가 던지면 실패로 본다. */
function quickCheckOk(db: SqlitePort): boolean {
  try {
    const rows = db.prepare(QUICK_CHECK).all();
    return rows.length === 1 && rows[0]?.quick_check === 'ok';
  } catch {
    return false;
  }
}

/** DB마다: 파일 있음 → 열기 → application_id → 스키마 → (크래시 뒤) quick_check. 연 DB는 실패해도 `opened`에 남아 호출자가 닫는다. */
export function openDatabases(
  def: ServiceDefinitionBase,
  runtime: SqliteRuntime | null,
  env: BootstrapEnvelope,
  deps: { readonly metrics: MetricsRegistry; readonly log: Logger; readonly opened: SqlitePort[] },
): Step<OpenedDatabases> {
  const dbs: Record<string, SqlitePort> = {};
  const schemaVersions: Record<string, Record<string, number>> = {};
  const quickFailed: string[] = [];
  for (const database of def.databases) {
    if (runtime === null) {
      return stepFail(70, 'sqlite_runtime_missing');
    }
    const file = homePath(env.home, 'data', database.file);
    if (!existsSync(file)) {
      return stepFail(78, 'needs_migrate');
    }
    let db: SqlitePort;
    try {
      db = runtime.openDb(file, {
        synchronous: database.synchronous,
        recursiveTriggers: database.recursiveTriggers,
        metrics: deps.metrics,
      });
    } catch (e) {
      deps.log.error({ event: 'db.open.failed', db: database.file, err: e }, 'database open failed');
      return stepFail(70, 'db_open_failed');
    }
    deps.opened.push(db);
    dbs[database.file] = db;
    let applicationId: number;
    let verified: ReturnType<SqliteRuntime['verifySchema']>;
    try {
      applicationId = Number(db.prepare(APP_ID_GET).get()?.application_id ?? 0);
      verified = runtime.verifySchema(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...database.migrations], {
        profile: database.profile,
      });
    } catch (e) {
      deps.log.error({ event: 'db.check.failed', db: database.file, err: e }, 'database check failed');
      return stepFail(70, 'db_check_failed');
    }
    if (applicationId !== database.applicationId) {
      return stepFail(78, 'application_id_mismatch');
    }
    if (!verified.ok) {
      return stepFail(78, `schema_${verified.error.reason}`);
    }
    schemaVersions[database.file] = { ...verified.value.schemaVersions };
    if (env.flags.after_crash && !quickCheckOk(db)) {
      quickFailed.push(database.file);
    }
  }
  const fullFile = def.databases.find((d) => d.profile === 'full')?.file;
  return stepOk({ dbs, schemaVersions, quickFailed, fullDb: fullFile === undefined ? null : (dbs[fullFile] ?? null) });
}
