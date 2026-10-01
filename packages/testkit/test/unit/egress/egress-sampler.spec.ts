import { describe, expect, it } from 'vitest';
import { isLoopback, parseProcNet } from '../../../src/egress-sampler.js';

const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';

const TCP = `${HEADER}   0: 0100007F:1F90 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0
   1: 0202000A:A1B2 0102000A:01BB 02 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 100 0 0 10 0
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 33333 1 0000000000000000 100 0 0 10 0
`;

const TCP6 = `${HEADER}   0: 00000000000000000000000001000000:1F90 00000000000000000000000001000000:D431 01 00000000:00000000 00:00000000 00000000  1000        0 44444 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000001000000:A1B2 B80D0120000000000000000001000000:01BB 02 00000000:00000000 00:00000000 00000000  1000        0 55555 1 0000000000000000 100 0 0 10 0
   2: 0000000000000000FFFF00000202000A:A1B3 0000000000000000FFFF00000102000A:0050 01 00000000:00000000 00:00000000 00000000  1000        0 66666 1 0000000000000000 100 0 0 10 0
`;

describe('egress sampler parsing', () => {
  it('UT-TK-043 parseProcNet은 tcp 행(주소·포트·상태·inode)을 해석한다 [NFR-AVL-001]', () => {
    // parseProcNet은 tcp 행(주소·포트·상태·inode)을 해석한다 [NFR-AVL-001]
    {
      // Act
      const rows = parseProcNet(TCP, 'tcp');
      // Assert
      expect(rows).toEqual([
        {
          family: 'tcp',
          localAddress: '127.0.0.1',
          localPort: 8080,
          remoteAddress: '127.0.0.1',
          remotePort: 50000,
          state: 'ESTABLISHED',
          inode: 11111,
        },
        {
          family: 'tcp',
          localAddress: '10.0.2.2',
          localPort: 41394,
          remoteAddress: '10.0.2.1',
          remotePort: 443,
          state: 'SYN_SENT',
          inode: 22222,
        },
        {
          family: 'tcp',
          localAddress: '0.0.0.0',
          localPort: 22,
          remoteAddress: '0.0.0.0',
          remotePort: 0,
          state: 'LISTEN',
          inode: 33333,
        },
      ]);
      expect(parseProcNet('', 'tcp')).toEqual([]);
      expect(parseProcNet(`${HEADER}garbage line\n`, 'udp')).toEqual([]);
    }
    // parseProcNet은 tcp6 주소(::1·2001:db8::1·IPv4 매핑)를 해석한다 [NFR-AVL-001]
    {
      // Act
      const rows = parseProcNet(TCP6, 'tcp6');
      // Assert
      expect(rows.map((r) => [r.localAddress, r.remoteAddress, r.remotePort, r.state, r.inode])).toEqual([
        ['::1', '::1', 54321, 'ESTABLISHED', 44444],
        ['::1', '2001:db8::1', 443, 'SYN_SENT', 55555],
        ['::ffff:10.0.2.2', '::ffff:10.0.2.1', 80, 'ESTABLISHED', 66666],
      ]);
    }
  });

  it('UT-TK-044 isLoopback은 127/8·::1·매핑 loopback·localhost만 참이다 [NFR-AVL-001]', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.1.2.3')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('10.0.2.1')).toBe(false);
    expect(isLoopback('203.0.113.1')).toBe(false);
    expect(isLoopback('2001:db8::1')).toBe(false);
    expect(isLoopback('128.0.0.1')).toBe(false);
  });
});
