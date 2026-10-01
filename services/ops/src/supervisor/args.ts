import path from 'node:path';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { LogLevel } from '@fathom/shared-kernel/log/log';

// ADR-012 §1 · Brief T-00-11 §4.1.1 — supervisor는 인자만 읽고 env로 설정을 받지 않는다.
export type SupervisorArgs = {
  readonly profile: 'prod' | 'dev' | 'test';
  readonly home: string;
  readonly runtime: 'src' | 'dist';
  readonly safe: boolean;
  readonly foreground: boolean;
  readonly logLevel: LogLevel;
  readonly entries: string | null;
};

type ParseError = { readonly reason: string };

const VALUED_KEYS: ReadonlySet<string> = new Set(['profile', 'home', 'runtime', 'log-level', 'entries']);
const FLAG_KEYS: ReadonlySet<string> = new Set(['safe', 'foreground']);
const PROFILES: readonly string[] = ['prod', 'dev', 'test'];
const RUNTIMES: readonly string[] = ['src', 'dist'];
const LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error'];

function isProfile(v: string): v is SupervisorArgs['profile'] {
  return PROFILES.includes(v);
}
function isRuntime(v: string): v is SupervisorArgs['runtime'] {
  return RUNTIMES.includes(v);
}
function isLevel(v: string): v is LogLevel {
  return LEVELS.includes(v);
}
function isAbsolute(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
}

/** `--key=value`·`--flag`만 허용한다. 모르는 키·중복·상대 경로·prod/dev의 `--entries`는 실패. */
function collect(argv: readonly string[]): Result<Map<string, string>, ParseError> {
  const seen = new Map<string, string>();
  for (const arg of argv) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/s.exec(arg);
    if (m === null) {
      return err({ reason: 'bad_argument' });
    }
    const key = m[1] ?? '';
    const value = m[2];
    if (seen.has(key)) {
      return err({ reason: `duplicate:${key}` });
    }
    if (VALUED_KEYS.has(key)) {
      if (value === undefined || value === '') {
        return err({ reason: `missing_value:${key}` });
      }
      seen.set(key, value);
    } else if (FLAG_KEYS.has(key)) {
      if (value !== undefined) {
        return err({ reason: `unexpected_value:${key}` });
      }
      seen.set(key, '');
    } else {
      return err({ reason: `unknown:${key}` });
    }
  }
  return ok(seen);
}

export function parseSupervisorArgs(argv: readonly string[]): Result<SupervisorArgs, ParseError> {
  const collected = collect(argv);
  if (!collected.ok) {
    return collected;
  }
  const m = collected.value;
  const profile = m.get('profile');
  if (profile === undefined || !isProfile(profile)) {
    return err({ reason: 'profile_required' });
  }
  const home = m.get('home');
  if (home === undefined || !isAbsolute(home)) {
    return err({ reason: 'home_required_absolute' });
  }
  const runtime = m.get('runtime') ?? 'dist';
  if (!isRuntime(runtime)) {
    return err({ reason: 'bad_runtime' });
  }
  const logLevel = m.get('log-level') ?? 'info';
  if (!isLevel(logLevel)) {
    return err({ reason: 'bad_log_level' });
  }
  const entries = m.get('entries') ?? null;
  if (entries !== null && (profile !== 'test' || !isAbsolute(entries))) {
    return err({ reason: 'entries_test_only_absolute' });
  }
  return ok({ profile, home, runtime, safe: m.has('safe'), foreground: m.has('foreground'), logLevel, entries });
}
