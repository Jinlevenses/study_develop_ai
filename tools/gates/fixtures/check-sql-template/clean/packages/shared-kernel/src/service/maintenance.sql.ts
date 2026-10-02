// CR-70: pragma_allow에 파일 단위로 등록된 유지보수 SQL 모듈.
export const WAL_CHECKPOINT = 'PRAGMA wal_checkpoint(TRUNCATE)';
export const OPTIMIZE = 'PRAGMA optimize';
