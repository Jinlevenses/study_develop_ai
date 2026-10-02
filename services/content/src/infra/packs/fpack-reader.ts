import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { PackKpi } from '@fathom/contracts/http/content/v1/catalog';
import { FeasibilityBlocker } from '@fathom/contracts/common/practice';
import { S } from '@fathom/contracts/common/schema';
import { FpackManifest } from '@fathom/contracts/pack/manifest';
import { BundleRecord } from '@fathom/contracts/pack/records';
import { canonicalJson, parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { z } from 'zod';
import { merkleRoot } from './merkle.js';
import type { UstarEntry } from './ustar.js';
import { parseFpackTar } from './ustar.js';

// PGM-CT-001·002 `.fpack` 검증 — Brief T-01-07 §4.3. 부모(설치 요청)와 job(pack-load)이 같은 함수를 쓴다.
// 하나라도 어기면 err(쓰기 0). `FpackFault.reason`은 CT-VAL-011 detail이 되므로 경로·원문을 담지 않는다(STD-LOG-22).

export const MAX_FPACK_BYTES = 64 * 1024 * 1024;
export const MAX_BUNDLE_LINE_BYTES = 1024 * 1024;

/** `source_sha256`는 파일 바이트를 읽은 뒤의 실패에만 있다(job이 파일 교체 TOCTOU를 `source_changed`로 가르는 데 쓴다). */
export type FpackFault = { readonly reason: string; readonly detail: string; readonly source_sha256?: string };
export type VerifiedFpack = {
  readonly manifest: FpackManifest;
  readonly manifest_hash: string;
  readonly source_sha256: string;
  readonly report_canonical: string;
  readonly records: readonly BundleRecord[];
  readonly concept_ids: ReadonlySet<string>;
  readonly ku_hashes: ReadonlyMap<string, string>;
  readonly concept_hashes: ReadonlyMap<string, string>;
};
export type ReadFpackOptions = { readonly maxBytes?: number; readonly maxLineBytes?: number };

/** packc 소유 report.json 문서 중 content가 읽는 상위 키만 검증하고 나머지는 보존한다. */
const PackReportSlice = z.looseObject({
  kpi: PackKpi,
  tier_counts: S({ A: z.number().int(), B: z.number().int(), C: z.number().int() }),
  cap_blockers: z.array(FeasibilityBlocker).max(100),
});

const fault = (reason: string, detail: string): Result<never, FpackFault> => err({ reason, detail });

function readRegularFile(filePath: string, maxBytes: number): Result<Buffer, FpackFault> {
  if (path.extname(filePath) !== '.fpack') {
    return fault('file_invalid', 'extension must be .fpack');
  }
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return fault('file_invalid', 'file cannot be opened');
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) {
      return fault('file_invalid', 'not a regular file');
    }
    if (st.size > maxBytes) {
      return fault('too_large', `size ${st.size} exceeds ${maxBytes}`);
    }
    const buf = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = readSync(fd, buf, read, st.size - read, read);
      if (n === 0) {
        return fault('file_invalid', 'file shrank while reading');
      }
      read += n;
    }
    return ok(buf);
  } catch {
    return fault('file_invalid', 'file cannot be read');
  } finally {
    closeSync(fd);
  }
}

function omitContentHash(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'content_hash'));
}

function entryOf(entries: readonly UstarEntry[], name: UstarEntry['name']): Buffer {
  const found = entries.find((e) => e.name === name);
  if (found === undefined) {
    throw new Error(`invariant: ustar entry ${name} missing after strict parse`);
  }
  return found.bytes;
}

function parseJsonText(bytes: Buffer): unknown {
  return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** 번들을 `\n`으로 끝나는 줄들로 쪼갠다(줄 바이트에 `\n` 제외). 마지막이 `\n`이 아니면 null. */
function splitLines(bundle: Buffer): Buffer[] | null {
  if (bundle.length === 0 || bundle[bundle.length - 1] !== 0x0a) {
    return null;
  }
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bundle.length; i += 1) {
    if (bundle[i] === 0x0a) {
      lines.push(bundle.subarray(start, i));
      start = i + 1;
    }
  }
  return lines;
}

export function readFpack(filePath: string, opts: ReadFpackOptions = {}): Result<VerifiedFpack, FpackFault> {
  // 1. 일반 파일·확장자·크기
  const file = readRegularFile(filePath, opts.maxBytes ?? MAX_FPACK_BYTES);
  if (!file.ok) {
    return file;
  }
  const sourceSha = sha256Hex(file.value);
  const verified = verifyFpackBytes(file.value, sourceSha, opts.maxLineBytes ?? MAX_BUNDLE_LINE_BYTES);
  return verified.ok ? verified : err({ ...verified.error, source_sha256: sourceSha });
}

function verifyFpackBytes(bytes: Buffer, sourceSha: string, maxLine: number): Result<VerifiedFpack, FpackFault> {
  // 2. ustar
  const tar = parseFpackTar(bytes);
  if (!tar.ok) {
    return fault('tar_invalid', tar.error);
  }
  const manifestBytes = entryOf(tar.value, 'manifest.json');
  const bundleBytes = entryOf(tar.value, 'bundle.jsonl');
  const reportBytes = entryOf(tar.value, 'report.json');
  const layoutBytes = entryOf(tar.value, 'layout.json');
  // 3. manifest·files[]
  let manifestParsed: ReturnType<typeof FpackManifest.safeParse>;
  try {
    manifestParsed = FpackManifest.safeParse(parseJsonText(manifestBytes));
  } catch {
    return fault('manifest_invalid', 'manifest.json is not valid JSON');
  }
  if (!manifestParsed.success) {
    return fault('manifest_invalid', 'manifest.json violates FpackManifest');
  }
  const manifest = manifestParsed.data;
  const actual = { 'bundle.jsonl': bundleBytes, 'report.json': reportBytes, 'layout.json': layoutBytes } as const;
  for (const name of ['bundle.jsonl', 'report.json', 'layout.json'] as const) {
    const listed = manifest.files.filter((f) => f.path === name);
    const one = listed[0];
    if (listed.length !== 1 || one === undefined) {
      return fault('manifest_invalid', `files[] must list ${name} exactly once`);
    }
    const bytes = actual[name];
    if (one.bytes !== bytes.length || one.sha256 !== sha256Hex(bytes)) {
      return fault('file_hash_mismatch', `${name} differs from manifest files[]`);
    }
  }
  // 4. bundle.jsonl 줄
  const lines = splitLines(bundleBytes);
  if (lines === null) {
    return fault('record_invalid:0', 'bundle.jsonl must end with a newline');
  }
  const records: BundleRecord[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i];
    if (line === undefined || line.length > maxLine) {
      return fault(`record_invalid:${lineNo}`, 'bundle line exceeds 1 MiB');
    }
    let parsed: ReturnType<typeof BundleRecord.safeParse>;
    try {
      parsed = BundleRecord.safeParse(parseJsonText(line));
    } catch {
      return fault(`record_invalid:${lineNo}`, 'bundle line is not valid JSON');
    }
    if (!parsed.success) {
      return fault(`record_invalid:${lineNo}`, 'bundle line violates BundleRecord');
    }
    const record = parsed.data;
    if (record.kind !== 'gate_result' && 'content_hash' in record) {
      if (record.content_hash !== sha256Hex(canonicalJson(omitContentHash(record)))) {
        return fault(`record_hash_mismatch:${lineNo}`, `${record.kind} content_hash differs from its canonical form`);
      }
    }
    records.push(record);
  }
  // 5. merkle
  if (merkleRoot(lines) !== manifest.merkle_root) {
    return fault('merkle_mismatch', 'merkle root differs from manifest');
  }
  // 6. 일관성
  const tracks = records.filter((r) => r.kind === 'track');
  const onlyTrack = tracks[0];
  if (tracks.length !== 1 || onlyTrack === undefined || onlyTrack.track_id !== manifest.track) {
    return fault('manifest_inconsistent', 'bundle must hold exactly one track record equal to manifest.track');
  }
  const count = (kind: BundleRecord['kind']): number => records.filter((r) => r.kind === kind).length;
  for (const r of records) {
    if (r.kind === 'concept' && r.track_id !== manifest.track) {
      return fault('manifest_inconsistent', 'concept track_id differs from manifest.track');
    }
  }
  const counts = manifest.counts;
  if (
    counts.concepts !== count('concept') ||
    counts.kus !== count('ku') ||
    counts.misconceptions !== count('misconception') ||
    counts.items !== count('item') ||
    counts.cases !== count('case')
  ) {
    return fault('manifest_inconsistent', 'manifest.counts differs from the bundle');
  }
  // 7. report·layout
  let reportCanonical: string;
  try {
    const reportDoc = parseJsonText(reportBytes);
    if (!PackReportSlice.safeParse(reportDoc).success) {
      return fault('report_invalid', 'report.json lacks kpi/tier_counts/cap_blockers');
    }
    reportCanonical = canonicalJson(reportDoc);
    const layoutDoc = parseJsonText(layoutBytes);
    if (typeof layoutDoc !== 'object' || layoutDoc === null || Array.isArray(layoutDoc)) {
      return fault('report_invalid', 'layout.json must be a JSON object');
    }
  } catch {
    return fault('report_invalid', 'report.json or layout.json is not valid JSON');
  }
  const conceptHashes = new Map<string, string>();
  const kuHashes = new Map<string, string>();
  for (const r of records) {
    if (r.kind === 'concept') {
      conceptHashes.set(r.concept_id, r.content_hash);
    } else if (r.kind === 'ku') {
      kuHashes.set(r.ku_id, r.content_hash);
    }
  }
  return ok({
    manifest,
    manifest_hash: sha256Hex(manifestBytes),
    source_sha256: sourceSha,
    report_canonical: reportCanonical,
    records,
    concept_ids: new Set(conceptHashes.keys()),
    ku_hashes: kuHashes,
    concept_hashes: conceptHashes,
  });
}
