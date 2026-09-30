// Child: start backup() and close the source connection while it is still in flight (mode 'close'),
// or await it first (mode 'await'). Used to see whether closing mid-backup is safe.
import { DatabaseSync, backup } from 'node:sqlite';
import { rmSync } from 'node:fs';
const [src, dest, mode] = process.argv.slice(2);
for (const s of ['', '-wal', '-shm']) rmSync(dest + s, { force: true });
const db = new DatabaseSync(src);
const p = backup(db, dest, { rate: 1 });   // 1 page per step -> stays in flight for a while
if (mode === 'close') {
  await new Promise((r) => setTimeout(r, 5));
  try { db.close(); console.log('closed while in flight'); } catch (e) { console.log('close threw', e.code, e.message); }
  try { const n = await p; console.log('backup resolved', n); } catch (e) { console.log('backup rejected', e.code, e.message); }
} else {
  const n = await p; db.close(); console.log('backup resolved', n);
}
