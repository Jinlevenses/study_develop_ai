// 무압축 POSIX ustar(Brief T-01-03 §4.8-7). 항목 순서는 호출자가 정한다, 디렉터리 항목 0, 데이터는 512 배수로 0 패딩, 끝에 0블록 2개.
// 헤더: name(100) · mode 0000644\0 · uid/gid 0000000\0 · size 11자리 8진 + \0 · mtime 00000000000\0 · chksum(8칸 공백으로 계산 →
// 6자리 8진 + \0 + 공백) · typeflag '0' · magic ustar\0 · version 00 · uname/gname 빈칸.
export type TarEntry = { readonly name: string; readonly data: Uint8Array };

const BLOCK = 512;

function putString(buf: Buffer, offset: number, length: number, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > length) {
    throw new Error(`invariant: tar field overflow (${text})`);
  }
  bytes.copy(buf, offset);
}

function octal(value: number, digits: number): string {
  return value.toString(8).padStart(digits, '0');
}

export function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  putString(h, 0, 100, name);
  putString(h, 100, 8, '0000644\0');
  putString(h, 108, 8, '0000000\0');
  putString(h, 116, 8, '0000000\0');
  putString(h, 124, 12, `${octal(size, 11)}\0`);
  putString(h, 136, 12, '00000000000\0');
  h.fill(0x20, 148, 156); // chksum 계산 시 8칸 공백
  h[156] = 0x30; // typeflag '0'
  putString(h, 257, 6, 'ustar\0');
  putString(h, 263, 2, '00');
  let sum = 0;
  for (const b of h) {
    sum += b;
  }
  putString(h, 148, 8, `${octal(sum, 6)}\0 `);
  return h;
}

export function buildTar(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(tarHeader(e.name, e.data.length));
    const data = Buffer.from(e.data);
    parts.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) {
      parts.push(Buffer.alloc(pad, 0));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}
