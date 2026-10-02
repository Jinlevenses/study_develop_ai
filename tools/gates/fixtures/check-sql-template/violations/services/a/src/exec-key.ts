// CR-70 대조군: 같은 패턴이 서비스 파일에 있으면 dynamic-arg 위반이 유지된다(면제는 packages/contracts/src/** 한정).
const PATTERNS: Record<string, { exec(s: string): unknown }> = {};
export const matchKey = (type: string, key: string) => PATTERNS[type]?.exec(key); // EXPECT[sql/dynamic-arg]
