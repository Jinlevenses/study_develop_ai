// UT-TK-011 탐침: 비내부 IPv4에 서버를 열고 같은 주소로 연결해 유지하거나(`self`), 접근 불가 주소로 SYN을 시도한다(`syn`).
import net from 'node:net';

const mode = process.argv[2];
const address = process.argv[3];

process.stdin.resume();
process.stdin.on('end', () => process.exit(0));

if (mode === 'self') {
  const server = net.createServer((socket) => socket.resume());
  server.listen(0, address, () => {
    const client = net.connect(server.address().port, address, () => process.stdout.write('ready\n'));
    client.on('error', (e) => process.stdout.write(`error:${e.code}\n`));
  });
} else {
  const client = net.connect(9, address);
  client.on('error', (e) => process.stdout.write(`error:${e.code}\n`));
  process.stdout.write('ready\n');
}
