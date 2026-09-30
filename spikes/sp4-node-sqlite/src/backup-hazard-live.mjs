// Child: backup() under a live full-speed writer never finishes (restarts); after 1.5s call db.close() with the backup still pending.
import { DatabaseSync, backup } from 'node:sqlite';
import { rmSync } from 'node:fs';
const [src, dest] = process.argv.slice(2);
for (const s of ['', '-wal', '-shm']) rmSync(dest + s, { force: true });
const db = new DatabaseSync(src, { timeout: 5000 });
let calls = 0;
const p = backup(db, dest, { progress: () => { calls++; } });
p.catch((e) => console.log('backup rejected', e.code, e.message));
await new Promise((r) => setTimeout(r, 1500));
try { db.close(); console.log('closed; progress calls so far', calls); } catch (e) { console.log('close threw', e.code, e.message); }
await new Promise((r) => setTimeout(r, 1500));
console.log('still alive after close');
process.exit(0);
