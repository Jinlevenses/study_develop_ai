import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB01 = fileURLToPath(new URL('../../../../../../docs/02-design/03-database-design.md', import.meta.url));

/** DB-01의 `-- <NAME> …` 주석 다음 문장(빈 줄·펜스·다음 주석 전까지). */
export function docSql(name: string): string {
  const lines = readFileSync(DB01, 'utf8').split('\n');
  const at = lines.findIndex((l) => l === `-- ${name}` || l.startsWith(`-- ${name} `));
  if (at < 0) {
    throw new Error(`doc statement not found: ${name}`);
  }
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line === '' || line.startsWith('```') || line.startsWith('-- ')) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

/** 공백 접기 + 끝 세미콜론 제거 — 문장 비교용. */
export const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
