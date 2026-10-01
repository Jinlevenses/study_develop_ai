// ported-from: spikes/sp4-node-sqlite/src/warnings.mjs (case 10 emitOverride; audit-fixed: filter only ExperimentalWarning+SQLite, no process.on('warning'))
import type { WarningTarget } from './process-port.js';
import { processWarningTarget } from './process-port.js';

// STD-SQL-02 · R-07 — `node:sqlite`의 ExperimentalWarning(SQLite)만 버리는 진입점 로더.
// `process.on('warning')`·`removeAllListeners('warning')`·`--no-warnings`는 쓰지 않는다 — 다른 경고는 그대로 흐른다.
// 이 모듈의 `sqlite/sqlite` 참조는 `import type`과 아래 리터럴 동적 import 하나뿐이다(정적 값 import 1개라도 있으면 필터가 무력화된다).

export type SqliteRuntime = Pick<
  typeof import('@fathom/shared-kernel/sqlite/sqlite'),
  'openDb' | 'migrate' | 'verifySchema' | 'readMigrationBundle' | 'vacuumInto'
>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** `emitWarning(warning, type?)`·`emitWarning(warning, {type})`·`emitWarning(Error)` 세 호출 모양에서 유형을 읽는다. */
function warningType(args: readonly unknown[]): string | undefined {
  const [warning, second] = args;
  if (typeof second === 'string') {
    return second;
  }
  if (isRecord(second) && typeof second.type === 'string') {
    return second.type;
  }
  return warning instanceof Error ? warning.name : undefined;
}

function warningMessage(args: readonly unknown[]): string {
  const [warning] = args;
  if (typeof warning === 'string') {
    return warning;
  }
  return warning instanceof Error ? warning.message : '';
}

/** 유형이 `ExperimentalWarning`이고 메시지에 `SQLite`가 든 경고만 버린다. 나머지는 원래 `emitWarning`으로 넘긴다. */
export function installSqliteWarningFilter(target: WarningTarget): void {
  const original = target.emitWarning;
  const filtered = (...args: unknown[]): void => {
    if (warningType(args) === 'ExperimentalWarning' && warningMessage(args).includes('SQLite')) {
      return;
    }
    Reflect.apply(original, target, args);
  };
  target.emitWarning = filtered;
}

/** 로더 1개(= 클로저 캐시 1개). 같은 로더의 2번째 호출은 같은 Promise를 돌려준다(모듈 전역 0). */
export function createSqliteLoader(target: WarningTarget): () => Promise<SqliteRuntime> {
  let loaded: Promise<SqliteRuntime> | null = null;
  return (): Promise<SqliteRuntime> => {
    loaded ??= (async (): Promise<SqliteRuntime> => {
      installSqliteWarningFilter(target);
      await import('node:sqlite'); // boundary-ok: STD-SQL-02 진입점 경고 억제 후 사전 로드
      const mod = await import('@fathom/shared-kernel/sqlite/sqlite'); // boundary-ok: STD-SQL-02 경고 억제 뒤에야 sqlite 모듈을 평가한다
      return {
        openDb: mod.openDb,
        migrate: mod.migrate,
        verifySchema: mod.verifySchema,
        readMigrationBundle: mod.readMigrationBundle,
        vacuumInto: mod.vacuumInto,
      };
    })();
    return loaded;
  };
}

/** 실제 `process`에 필터를 거는 로더. 호출마다 새 캐시이므로 createService가 1개 만들어 공유한다. */
export function loadSqliteRuntime(): Promise<SqliteRuntime> {
  return createSqliteLoader(processWarningTarget())();
}
