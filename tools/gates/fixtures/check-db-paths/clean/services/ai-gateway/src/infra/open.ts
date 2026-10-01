// ai.db 와 ai-cache.db 는 같은 서비스 소유 — 접두 `ai`가 `ai-cache.db`에 오검출되면 안 된다
export const MAIN = 'ai.db';
export const CACHE = 'ai-cache.db';
export const NOT_A_DB = 'main.ai.db.bak and my-ai.db and ai.dbx';
