// UT-TK-045/046 탐침: record 모드에서 loopback 연결(미기록)·node spawn(미기록)·비 node spawn(기록)을 수행한다.
import { execSync, spawnSync } from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';

const mode = process.argv[2];

if (mode === 'record') {
  const server = net.createServer((socket) => socket.end());
  server.listen(0, '127.0.0.1', () => {
    const client = net.connect(server.address().port, '127.0.0.1');
    client.on('close', () => {
      server.close();
      spawnSync(process.execPath, ['-e', '0']);
      spawnSync('/bin/true');
      execSync('echo sk-ant-abcdefABCDEF123456 > /dev/null');
      process.stdout.write('done\n');
    });
    client.resume();
  });
} else {
  // fallback: block 모드 DNS 한 번(플랫폼 무관)
  dns.lookup('example.com', () => process.stdout.write('done\n'));
}
