import path from 'node:path';

export const dbPath = (dir: string) => path.join(dir, 'content.db');
export const walPath = (dir: string) => `${dir}/content.db-wal`;
