// testkit은 모든 DB 이름을 만들어도 된다(db_paths_exempt)
export const NAMES = ['content.db', 'learning.db', 'insight.db', 'ai.db', 'ai-cache.db', 'ops.db'];
export const SQL = 'ATTACH DATABASE ? AS other';
