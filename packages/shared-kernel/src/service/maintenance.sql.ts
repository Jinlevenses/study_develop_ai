// DB-01 §3.1 PRAGMA 표 · §4 — 서비스 공통 운영 SQL. [Brief 결정 — STD-SQL-04 범위 확장]
// sqlite 모듈(T-00-04)은 이 Task가 고칠 수 없으므로 shared-kernel `service` 안에 둔다(서비스 코드의 PRAGMA 0은 유지).
// T1이 STD-SQL-04 문구 정정을 CR 후보로 기록한다.

export const APP_ID_GET = `PRAGMA application_id`;
export const QUICK_CHECK = `PRAGMA quick_check`;
export const INTEGRITY_CHECK = `PRAGMA integrity_check`;
export const FK_CHECK = `PRAGMA foreign_key_check`;
export const WAL_CHECKPOINT_PASSIVE = `PRAGMA wal_checkpoint(PASSIVE)`;
export const OPTIMIZE = `PRAGMA optimize`;
export const SCHEMA_VERSIONS_GET = `SELECT module, max(version) AS v FROM schema_migrations GROUP BY module`;
/** restore가 복사한 사본의 저널 모드를 서비스 연결 프로파일(WAL)로 맞춘다(DB-01 §3.1). */
export const JOURNAL_MODE_WAL = `PRAGMA journal_mode=WAL`;
