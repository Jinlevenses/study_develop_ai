import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// T-01-03 Brief §4.8-7(packc emit)의 역방향 — 무압축 POSIX ustar 엄격 파서.
// 항목은 정확히 manifest.json → bundle.jsonl → report.json → layout.json 순, 디렉터리 항목 0, 끝 0블록 2개 뒤에는 0 바이트뿐.

const BLOCK = 512;
export const FPACK_ENTRY_NAMES = ['manifest.json', 'bundle.jsonl', 'report.json', 'layout.json'] as const;
export type FpackEntryName = (typeof FPACK_ENTRY_NAMES)[number];
export type UstarEntry = { readonly name: FpackEntryName; readonly bytes: Buffer };

const NAME_END = 100;
const CHKSUM_START = 148;
const CHKSUM_END = 156;
const TYPEFLAG_AT = 156;
const MAGIC_START = 257;
const VERSION_START = 263;
const PREFIX_START = 345;
const PREFIX_END = 500;
const SIZE_START = 124;
const SIZE_END = 136;

function isZeroBlock(buf: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK; i += 1) {
    if (buf[i] !== 0) {
      return false;
    }
  }
  return true;
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    sum += i >= CHKSUM_START && i < CHKSUM_END ? 0x20 : (header[i] ?? 0);
  }
  return sum;
}

/** 8진 숫자 칸(공백·NUL로 끝남)을 읽는다. 8진 숫자가 아닌 바이트·빈 칸 = null. */
function readOctal(header: Buffer, start: number, end: number): number | null {
  let text = '';
  for (let i = start; i < end; i += 1) {
    const b = header[i] ?? 0;
    if (b === 0 || b === 0x20) {
      break;
    }
    if (b < 0x30 || b > 0x37) {
      return null;
    }
    text += String.fromCharCode(b);
  }
  if (text === '') {
    return null;
  }
  const n = Number.parseInt(text, 8);
  return Number.isSafeInteger(n) ? n : null;
}

function readName(header: Buffer): string | null {
  let end = 0;
  while (end < NAME_END && header[end] !== 0) {
    end += 1;
  }
  if (end === 0) {
    return null;
  }
  // NUL 뒤에 남은 바이트가 있으면 비정상 패딩이다.
  for (let i = end; i < NAME_END; i += 1) {
    if (header[i] !== 0) {
      return null;
    }
  }
  return header.toString('utf8', 0, end);
}

/** 오류 = 사유 문자열(`tar_invalid`의 detail). */
export function parseFpackTar(buf: Buffer): Result<readonly UstarEntry[], string> {
  const entries: UstarEntry[] = [];
  let offset = 0;
  for (const expected of FPACK_ENTRY_NAMES) {
    if (offset + BLOCK > buf.length) {
      return err(`truncated before ${expected}`);
    }
    if (isZeroBlock(buf, offset)) {
      return err(`missing entry ${expected}`);
    }
    const header = buf.subarray(offset, offset + BLOCK);
    const stored = readOctal(header, CHKSUM_START, CHKSUM_END);
    if (stored === null || stored !== headerChecksum(header)) {
      return err(`checksum mismatch at ${expected}`);
    }
    if (header[TYPEFLAG_AT] !== 0x30) {
      return err(`typeflag of ${expected} is not a regular file`);
    }
    if (header.toString('latin1', MAGIC_START, MAGIC_START + 6) !== 'ustar\0') {
      return err(`magic of ${expected} is not ustar`);
    }
    if (header.toString('latin1', VERSION_START, VERSION_START + 2) !== '00') {
      return err(`ustar version of ${expected} is not 00`);
    }
    for (let i = PREFIX_START; i < PREFIX_END; i += 1) {
      if (header[i] !== 0) {
        return err(`prefix of ${expected} is not empty`);
      }
    }
    const name = readName(header);
    if (name !== expected) {
      return err(`entry ${entries.length + 1} must be ${expected}`);
    }
    const size = readOctal(header, SIZE_START, SIZE_END);
    if (size === null) {
      return err(`size of ${expected} is not octal`);
    }
    const dataStart = offset + BLOCK;
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    if (dataStart + padded > buf.length) {
      return err(`data of ${expected} is truncated`);
    }
    for (let i = dataStart + size; i < dataStart + padded; i += 1) {
      if (buf[i] !== 0) {
        return err(`padding of ${expected} is not zero`);
      }
    }
    entries.push({ name: expected, bytes: buf.subarray(dataStart, dataStart + size) });
    offset = dataStart + padded;
  }
  // 끝 0블록 2개, 그 뒤는 0 패딩뿐.
  if (offset + 2 * BLOCK > buf.length) {
    return err('missing end-of-archive blocks');
  }
  for (let i = offset; i < buf.length; i += 1) {
    if (buf[i] !== 0) {
      return err('unexpected data after the fourth entry');
    }
  }
  return ok(entries);
}
