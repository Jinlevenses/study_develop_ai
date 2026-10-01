import path from 'node:path';
import { JobName } from '@fathom/contracts/admin/jobs';
import { ServiceName } from '@fathom/contracts/common/ids';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { z } from 'zod';

// §4.3.4 `--mode` 분기 — argv(`--key=value`·`--flag`만) 파싱. 모르는 키·모드·형식 오류 = 64.

export type ParsedMode =
  | { readonly mode: 'serve' }
  | { readonly mode: 'migrate'; readonly dryRun: boolean; readonly dbCopyDir: string | null }
  | { readonly mode: 'restore'; readonly from: string; readonly rewind: Readonly<Partial<Record<ServiceName, number>>> }
  | { readonly mode: 'verify'; readonly replay: boolean; readonly dbCopyDir: string | null }
  | { readonly mode: 'job'; readonly job: JobName };

const MODES = ['serve', 'migrate', 'restore', 'verify', 'job'] as const;
type ModeName = (typeof MODES)[number];
const KEYS: Readonly<Record<ModeName, readonly string[]>> = {
  serve: ['mode'],
  migrate: ['mode', 'dry-run', 'db-copy-dir'],
  restore: ['mode', 'from', 'rewind-cursors'],
  verify: ['mode', 'replay', 'db-copy-dir'],
  job: ['mode', 'job'],
};
const FLAGS: ReadonlySet<string> = new Set(['dry-run', 'replay']);
const ARG_RE = /^--([a-z][a-z-]*)(?:=(.*))?$/;
const RewindCursors = z.partialRecord(ServiceName, z.number().int().min(0));

function isMode(v: string): v is ModeName {
  return (MODES as readonly string[]).includes(v);
}

function collect(argv: readonly string[]): Result<Map<string, string | true>, string> {
  const map = new Map<string, string | true>();
  for (const token of argv) {
    const m = ARG_RE.exec(token);
    if (m === null) {
      return err('unrecognized argument');
    }
    const key = m[1] ?? '';
    if (map.has(key)) {
      return err(`duplicate --${key}`);
    }
    map.set(key, m[2] === undefined ? true : m[2]);
  }
  return ok(map);
}

function optionValue(map: ReadonlyMap<string, string | true>, key: string): Result<string | null, string> {
  const v = map.get(key);
  if (v === undefined) {
    return ok(null);
  }
  return typeof v === 'string' && v !== '' ? ok(v) : err(`--${key} needs a value`);
}

function absolute(map: ReadonlyMap<string, string | true>, key: string): Result<string | null, string> {
  const v = optionValue(map, key);
  if (!v.ok || v.value === null) {
    return v;
  }
  return path.isAbsolute(v.value) ? v : err(`--${key} must be an absolute path`);
}

export function parseModeArgs(argv: readonly string[]): Result<ParsedMode, string> {
  const map = collect(argv);
  if (!map.ok) {
    return map;
  }
  const modeValue = map.value.get('mode');
  const modeName = modeValue === undefined ? 'serve' : modeValue;
  if (typeof modeName !== 'string' || !isMode(modeName)) {
    return err('unknown --mode');
  }
  for (const [key, value] of map.value) {
    if (!KEYS[modeName].includes(key)) {
      return err(`--${key} is not valid for --mode=${modeName}`);
    }
    if (FLAGS.has(key) && value !== true) {
      return err(`--${key} takes no value`);
    }
  }
  switch (modeName) {
    case 'serve':
      return ok({ mode: 'serve' });
    case 'migrate':
    case 'verify': {
      const copy = absolute(map.value, 'db-copy-dir');
      if (!copy.ok) {
        return copy;
      }
      return ok(
        modeName === 'migrate'
          ? { mode: 'migrate', dryRun: map.value.get('dry-run') === true, dbCopyDir: copy.value }
          : { mode: 'verify', replay: map.value.get('replay') === true, dbCopyDir: copy.value },
      );
    }
    case 'restore':
      return parseRestore(map.value);
    case 'job': {
      const job = JobName.safeParse(map.value.get('job'));
      return job.success ? ok({ mode: 'job', job: job.data }) : err('unknown or missing --job');
    }
  }
}

function parseRestore(map: ReadonlyMap<string, string | true>): Result<ParsedMode, string> {
  const from = absolute(map, 'from');
  if (!from.ok) {
    return from;
  }
  if (from.value === null) {
    return err('--from is required');
  }
  const raw = optionValue(map, 'rewind-cursors');
  if (!raw.ok) {
    return raw;
  }
  let rewind: Partial<Record<ServiceName, number>> = {};
  if (raw.value !== null) {
    try {
      const parsed = RewindCursors.safeParse(parseJsonStrict(raw.value));
      if (!parsed.success) {
        return err('--rewind-cursors must map service names to integers >= 0');
      }
      rewind = parsed.data;
    } catch {
      return err('--rewind-cursors is not valid JSON');
    }
  }
  return ok({ mode: 'restore', from: from.value, rewind });
}
