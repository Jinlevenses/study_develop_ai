import type { ServiceName } from '@fathom/contracts/common/ids';
import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import { redactValues } from '../redact/redact.js';
import type { Clock } from '../time/time.js';

export type LogSvc = ServiceName | 'supervisor' | 'cli';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = PinoLogger;

export interface LoggerOptions {
  level: LogLevel;
  bootId: string | null;
  clock: Clock;
  destination?: { write(chunk: string): void };
  extraRedactPatterns?: readonly RegExp[];
  job?: string;
}

// STD-LOG-20 — 경로 redaction 목록
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-fathom-csrf"]',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.token',
  '*.self_token',
  'callers',
  '*.password',
  '*.passphrase',
  '*.bt',
  '*.csrf',
  '*.dek',
  '*.kek',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ERROR_LEVEL_VALUE = 50; // pino error

type SerializedErr = { code?: string; type: string; message: string; stack?: string; error_id?: string };

function stringProp(e: Error, key: 'code' | 'error_id'): string | undefined {
  if (key in e) {
    const value: unknown = Reflect.get(e, key);
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function serializeError(e: Error, withStack: boolean): SerializedErr {
  const out: SerializedErr = { type: e.name, message: e.message };
  const code = stringProp(e, 'code');
  if (code !== undefined) {
    out.code = code;
  }
  const errorId = stringProp(e, 'error_id');
  if (errorId !== undefined) {
    out.error_id = errorId;
  }
  if (withStack && e.stack !== undefined) {
    out.stack = e.stack;
  }
  return out;
}

function convertErrArg(first: unknown, level: number): unknown {
  const withStack = level >= ERROR_LEVEL_VALUE;
  if (first instanceof Error) {
    return { err: serializeError(first, withStack) };
  }
  if (typeof first === 'object' && first !== null && 'err' in first && first.err instanceof Error) {
    return { ...first, err: serializeError(first.err, withStack) };
  }
  return first;
}

/** STD-LOG-02 — 로거는 이 함수로만 만든다. stdout pino JSON 한 줄(ADR-015). */
export function createLogger(svc: LogSvc, opts: LoggerOptions): Logger {
  const { clock, extraRedactPatterns } = opts;
  const base: Record<string, unknown> = { svc, pid: process.pid, boot_id: opts.bootId, req_id: null };
  if (opts.job !== undefined) {
    base.job = opts.job;
  }
  const options: pino.LoggerOptions = {
    level: opts.level,
    base,
    messageKey: 'msg',
    timestamp: (): string => `,"ts":${clock.now()}`,
    formatters: {
      level: (label: string): object => ({ level: label }),
      log: (obj: Record<string, unknown>): Record<string, unknown> => {
        const redacted = redactValues(obj, extraRedactPatterns);
        return isRecord(redacted) ? redacted : {};
      },
    },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    serializers: { err: (value: unknown): unknown => value },
    hooks: {
      logMethod(args, method, level): void {
        const [first, ...rest] = args;
        const converted = convertErrArg(first, level);
        if (converted === first) {
          method.apply(this, args);
          return;
        }
        // pino는 첫 인자를 병합 객체로, 둘째 이후를 msg·보간 인자로 받는다.
        const forwarded: unknown[] = [converted, ...rest];
        Reflect.apply(method, this, forwarded);
      },
    },
  };
  return opts.destination !== undefined ? pino(options, opts.destination) : pino(options, pino.destination(1));
}
