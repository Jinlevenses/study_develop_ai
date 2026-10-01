// 통합 테스트용 자식 프로세스: 파일 DB에 짧은 쓰기 tx를 계속 쏜다. 첫 커밋 뒤 stdout에 `ready`를 한 줄 쓴다.
import { openDb } from '../../../../src/sqlite/sqlite.js';

const file = process.argv[2];
if (file === undefined) {
  throw new Error('invariant: writer fixture needs a db path');
}
const db = openDb(file, { synchronous: 'NORMAL' });
db.exec('CREATE TABLE IF NOT EXISTS ev(id INTEGER PRIMARY KEY, payload TEXT NOT NULL) STRICT');
const insert = db.prepare('INSERT INTO ev(payload) VALUES (?)');
const payload = 'x'.repeat(200);
let announced = false;
const deadline = performance.now() + 20_000;
while (performance.now() < deadline) {
  db.tx(() => {
    for (let i = 0; i < 5; i += 1) {
      insert.run(payload);
    }
  });
  if (!announced) {
    announced = true;
    process.stdout.write('ready\n');
  }
}
db.close();
