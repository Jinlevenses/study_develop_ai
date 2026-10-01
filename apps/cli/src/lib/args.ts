import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// Brief §4.2.2 — `fathom <command> [--flag] [--key=value]`. 모르는 명령·옵션·값은 `CLI-VAL-001` + exit 2.
export type Profile = 'prod' | 'dev' | 'test';
export type CommandName = 'up' | 'down' | 'status' | 'open';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Common = { readonly profile: Profile; readonly json: boolean };

export type Parsed =
  | { readonly kind: 'help'; readonly command: CommandName | null }
  | { readonly kind: 'version' }
  | ({
      readonly kind: 'up';
      readonly safe: boolean;
      readonly foreground: boolean;
      readonly noOpen: boolean;
      readonly logLevel: LogLevel;
      readonly entries: string | null;
    } & Common)
  | ({ readonly kind: 'open'; readonly noOpen: boolean; readonly entries: string | null } & Common)
  | ({ readonly kind: 'down' } & Common)
  | ({ readonly kind: 'status' } & Common);

export type UsageError = { readonly message: string };

const COMMANDS: readonly string[] = ['up', 'down', 'status', 'open'];
const FUTURE_COMMANDS: readonly string[] = [
  'doctor',
  'backup',
  'restore',
  'export',
  'import',
  'logs',
  'config',
  'update',
];
const COMMON_FLAGS = ['json', 'help'] as const;
const COMMON_VALUED = ['profile'] as const;
const PER_COMMAND: Record<CommandName, { flags: readonly string[]; valued: readonly string[] }> = {
  up: { flags: ['safe', 'foreground', 'no-open'], valued: ['log-level', 'entries'] },
  open: { flags: ['no-open'], valued: ['entries'] },
  down: { flags: [], valued: [] },
  status: { flags: [], valued: [] },
};

function isCommand(v: string): v is CommandName {
  return COMMANDS.includes(v);
}
function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}
const fail = (message: string): Result<never, UsageError> => err({ message });

type Collected = { readonly flags: ReadonlySet<string>; readonly values: ReadonlyMap<string, string> };

function collect(command: CommandName, rest: readonly string[]): Result<Collected, UsageError> {
  const spec = PER_COMMAND[command];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of rest) {
    const m = /^--([a-z][a-z-]*)(?:=(.*))?$/s.exec(arg);
    if (m === null) {
      return fail(`알 수 없는 인자: ${arg}`);
    }
    const key = m[1] ?? '';
    const value = m[2];
    if (flags.has(key) || values.has(key)) {
      return fail(`중복된 옵션: --${key}`);
    }
    if ([...COMMON_FLAGS, ...spec.flags].includes(key)) {
      if (value !== undefined) {
        return fail(`--${key}는 값을 받지 않습니다`);
      }
      flags.add(key);
    } else if ([...COMMON_VALUED, ...spec.valued].includes(key)) {
      if (value === undefined || value === '') {
        return fail(`--${key}에 값이 필요합니다`);
      }
      values.set(key, value);
    } else {
      return fail(`알 수 없는 옵션: --${key}`);
    }
  }
  return ok({ flags, values });
}

function build(command: CommandName, c: Collected): Result<Parsed, UsageError> {
  const profile = c.values.get('profile') ?? 'prod';
  if (profile !== 'prod' && profile !== 'dev' && profile !== 'test') {
    return fail('--profile은 prod|dev|test 중 하나여야 합니다');
  }
  const common: Common = { profile, json: c.flags.has('json') };
  const entries = c.values.get('entries') ?? null;
  if (entries !== null && (profile !== 'test' || !isAbsolute(entries))) {
    return fail('--entries는 --profile=test에서 절대 경로로만 쓸 수 있습니다');
  }
  if (command === 'up') {
    const level = c.values.get('log-level') ?? 'info';
    if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
      return fail('--log-level은 debug|info|warn|error 중 하나여야 합니다');
    }
    return ok({
      kind: 'up',
      ...common,
      safe: c.flags.has('safe'),
      foreground: c.flags.has('foreground'),
      noOpen: c.flags.has('no-open'),
      logLevel: level,
      entries,
    });
  }
  if (command === 'open') {
    return ok({ kind: 'open', ...common, noOpen: c.flags.has('no-open'), entries });
  }
  return ok({ kind: command, ...common });
}

export function parseArgs(argv: readonly string[]): Result<Parsed, UsageError> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    return fail('명령이 필요합니다');
  }
  if (first === '--version') {
    return rest.length === 0 ? ok({ kind: 'version' }) : fail('--version은 다른 인자와 함께 쓸 수 없습니다');
  }
  if (first === '--help' || first === 'help') {
    const target = rest[0];
    if (target === undefined) {
      return ok({ kind: 'help', command: null });
    }
    return isCommand(target) ? ok({ kind: 'help', command: target }) : fail(`알 수 없는 명령: ${target}`);
  }
  if (FUTURE_COMMANDS.includes(first)) {
    return fail(`아직 지원하지 않는 명령입니다: ${first}`);
  }
  if (!isCommand(first)) {
    return fail(`알 수 없는 명령: ${first}`);
  }
  if (rest.includes('--help')) {
    return ok({ kind: 'help', command: first });
  }
  const collected = collect(first, rest);
  return collected.ok ? build(first, collected.value) : collected;
}

const USAGE_LINES: Record<CommandName, string> = {
  up: '  fathom up [--profile=prod|dev] [--safe] [--foreground] [--no-open] [--log-level=info] [--json]\n    앱을 켭니다. 이미 켜져 있으면 브라우저만 엽니다.',
  open: '  fathom open [--no-open] [--json]\n    브라우저에서 Fathom을 엽니다. 꺼져 있으면 먼저 켭니다.',
  status: '  fathom status [--json]\n    실행 상태를 보여 줍니다.',
  down: '  fathom down [--json]\n    앱을 끕니다. 꺼져 있으면 아무 일도 하지 않습니다.',
};

export function usage(command: CommandName | null): string {
  if (command !== null) {
    return `사용법:\n${USAGE_LINES[command]}`;
  }
  return [
    '사용법: fathom <명령> [옵션]',
    '',
    '명령:',
    ...Object.values(USAGE_LINES),
    '',
    '전역 옵션: --help, --version',
  ].join('\n');
}
