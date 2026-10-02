// CR-70: contracts는 SQLite 수신자를 import할 수 없으므로(sqlite_direct 경계) `PATTERNS[type].exec(key)`는 RegExp#exec이다.
const PATTERNS: Record<string, { exec(s: string): unknown }> = {};
export const matchKey = (type: string, key: string) => PATTERNS[type]?.exec(key);
