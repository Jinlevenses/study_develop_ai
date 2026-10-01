// UT-TK-010 탐침: 기록기(block 모드)를 실은 채 외부 연결·DNS를 시도한다. 결과 코드를 stdout에 한 줄씩 쓴다.
import dns from 'node:dns';
import net from 'node:net';

let pending = 2;
const done = () => {
  pending -= 1;
  if (pending === 0) {
    process.stdout.write('done\n');
  }
};
net.connect(9, '203.0.113.1').on('error', (e) => {
  process.stdout.write(`connect:${e.code}\n`);
  done();
});
dns.lookup('example.com', (e) => {
  process.stdout.write(`dns:${e?.code}\n`);
  done();
});
