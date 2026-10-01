import type { ServiceName } from '@fathom/contracts/common/ids';
import type { Logger as PinoLogger } from 'pino';
import pino from 'pino';
import { redactString, redactValues } from '../redact/redact.js';
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

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 보간 인자(`%s %j %o`)를 가린다. 문자열은 값 패턴으로, 객체는 구조를 유지한 채 깊은 복사본의 모든 문자열 값에
 * redaction을 적용해 넘긴다(pino가 `%j`·`%o`로 msg에 펼쳐도 비밀이 남지 않는다). Error·클래스 인스턴스는 JSON 왕복 뒤 가린다.
 */
function redactArg(arg: unknown, extra: readonly RegExp[] | undefined): unknown {
  if (typeof arg === 'string') {
    return redactString(arg, extra);
  }
  if (typeof arg !== 'object' || arg === null) {
    return arg;
  }
  if (arg instanceof Error) {
    return redactString(`${arg.name}: ${arg.message}`, extra);
  }
  if (Array.isArray(arg) || isPlain(arg)) {
    return redactValues(arg, extra);
  }
  try {
    return redactValues(JSON.parse(JSON.stringify(arg)), extra);
  } catch {
    return redactString(Object.prototype.toString.call(arg), extra);
  }
}

/** child 바인딩이 이미 `req_id`를 가지면 병합 객체의 `req_id`는 버린다(바인딩이 이긴다 — 한 줄에 키가 두 번 쓰이지 않도록). */
function withoutReqId(first: unknown, hasBinding: boolean): unknown {
  if (hasBinding && isRecord(first) && !(first instanceof Error) && 'req_id' in first) {
    return Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'req_id'));
  }
  return first;
}

/**
 * pino에 넘길 인자를 만든다. 병합 객체(첫 인자)는 `formatters.log`가 값 redaction을 맡고,
 * msg·보간 인자(문자열·객체)는 여기서 가린다(STD-LOG-21). Error 첫 인자·`{err}`에 msg가 없으면 redaction한 message를 msg로 명시한다.
 */
function buildArgs(
  args: readonly unknown[],
  level: number,
  extra: readonly RegExp[] | undefined,
  hasBinding: boolean,
): unknown[] {
  const [rawFirst, ...rest] = args;
  const first = withoutReqId(rawFirst, hasBinding);
  const redactedRest = rest.map((arg): unknown => redactArg(arg, extra));
  const withStack = level >= ERROR_LEVEL_VALUE;
  if (first instanceof Error) {
    const msg = typeof redactedRest[0] === 'string' ? [] : [redactString(first.message, extra)];
    return [{ err: serializeError(first, withStack) }, ...msg, ...redactedRest];
  }
  if (typeof first === 'object' && first !== null && 'err' in first && first.err instanceof Error) {
    const msg = typeof redactedRest[0] === 'string' ? [] : [redactString(first.err.message, extra)];
    return [{ ...first, err: serializeError(first.err, withStack) }, ...msg, ...redactedRest];
  }
  return [redactArg(first, extra), ...redactedRest];
}

/** STD-LOG-02 — 로거는 이 함수로만 만든다. stdout pino JSON 한 줄(ADR-015). */
export function createLogger(svc: LogSvc, opts: LoggerOptions): Logger {
  const { clock, extraRedactPatterns } = opts;
  // req_id는 base에 두지 않는다 — child 바인딩과 같은 키가 두 번 쓰이지 않도록 mixin이 바인딩 부재 시에만 null을 더한다.
  const base: Record<string, unknown> = { svc, pid: process.pid, boot_id: opts.bootId };
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
    mixin(mergeObject: object, _level: number, self: PinoLogger): object {
      if ('req_id' in mergeObject || Object.hasOwn(self.bindings(), 'req_id')) {
        return {};
      }
      return { req_id: null };
    },
    hooks: {
      logMethod(args, method, level): void {
        Reflect.apply(
          method,
          this,
          buildArgs(args, level, extraRedactPatterns, Object.hasOwn(this.bindings(), 'req_id')),
        );
      },
    },
  };
  const logger = opts.destination !== undefined ? pino(options, opts.destination) : pino(options, pino.destination(1));
  guardChildBindings(logger, extraRedactPatterns);
  return logger;
}

/**
 * pino는 child 생성 시 `formatters.bindings`를 항등으로 되돌리므로(루트에서만 적용) 바인딩 값 redaction은 `child`를 감싸 적용한다.
 * 자식 로거는 부모를 프로토타입으로 상속하므로 손자에도 같은 래퍼가 쓰인다.
 */
function guardChildBindings(logger: PinoLogger, extra: readonly RegExp[] | undefined): void {
  const original = logger.child;
  const guarded = function (this: PinoLogger, bindings: unknown, options?: unknown): unknown {
    const redacted = redactValues(bindings, extra);
    return Reflect.apply(original, this, [isRecord(redacted) ? redacted : {}, options]);
  };
  Reflect.set(logger, 'child', guarded);
}
