// CR-70 대조군: 같은 디렉터리의 다른 파일은 PRAGMA 리터럴이 여전히 위반이다(파일 단위 허용).
export const SNEAKY = 'PRAGMA wal_checkpoint(TRUNCATE)'; // EXPECT[sql/pragma]
