// 테스트용 자체 ustar 리더(Brief T-01-03 UT-PACKC-075 · IT-663) — 헤더 필드를 검증하며 원본 바이트를 복원한다.
export type TarFile = {
  readonly name: string;
  readonly data: Buffer;
  readonly header: {
    readonly mode: string;
    readonly uid: string;
    readonly gid: string;
    readonly size: number;
    readonly mtime: string;
    readonly typeflag: string;
    readonly magic: string;
    readonly version: string;
    readonly uname: string;
    readonly gname: string;
    readonly checksumOk: boolean;
  };
};

function cstr(b: Buffer, from: number, to: number): string {
  const slice = b.subarray(from, to);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8');
}

export function readTar(buf: Buffer): { files: TarFile[]; trailingZeroBlocks: number; length: number } {
  const files: TarFile[] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) {
      break;
    }
    const size = Number.parseInt(cstr(h, 124, 136), 8);
    const stored = Number.parseInt(cstr(h, 148, 154), 8);
    const copy = Buffer.from(h);
    copy.fill(0x20, 148, 156);
    let sum = 0;
    for (const x of copy) {
      sum += x;
    }
    files.push({
      name: cstr(h, 0, 100),
      data: Buffer.from(buf.subarray(off + 512, off + 512 + size)),
      header: {
        mode: cstr(h, 100, 108),
        uid: cstr(h, 108, 116),
        gid: cstr(h, 116, 124),
        size,
        mtime: cstr(h, 136, 148),
        typeflag: String.fromCharCode(h[156] ?? 0),
        magic: h.subarray(257, 263).toString('latin1'),
        version: h.subarray(263, 265).toString('latin1'),
        uname: cstr(h, 265, 297),
        gname: cstr(h, 297, 329),
        checksumOk: stored === sum && h[154] === 0 && h[155] === 0x20,
      },
    });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  let trailing = 0;
  while (off + 512 <= buf.length && buf.subarray(off, off + 512).every((x) => x === 0)) {
    trailing += 1;
    off += 512;
  }
  return { files, trailingZeroBlocks: trailing, length: buf.length };
}
