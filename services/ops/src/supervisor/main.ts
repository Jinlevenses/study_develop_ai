import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readAllowedEnv } from '@fathom/shared-kernel/config/config';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { parseSupervisorArgs } from './args.js';
import type { EntryOverrides } from './bundle.js';
import { parseEntriesFile, readBundleInfo } from './bundle.js';
import { realSpawnChild } from './child.js';
import { realDevWatch } from './dev-watch.js';
import { createLogSink } from './log-sink.js';
import { acquireLock, createRuntimeFiles, ensureRunDirs } from './runtime-files.js';
import { createSupervisor } from './supervisor.js';

// ADR-012 §1 · Brief §4.1.1 — supervisor 진입점(STD-ASY-09 진입점 예외). 종료 코드: 0 정상 · 64 사용법 · 70 내부 오류 · 75 이미 실행 중.
const EXIT_USAGE = 64;
const EXIT_SOFTWARE = 70;
const EXIT_BUSY = 75;
const SHUTDOWN_GRACE_MS = 3000;

function stderrLine(text: string): void {
  process.stderr.write(`supervisor: ${text}\n`);
}

async function loadEntries(file: string | null): Promise<EntryOverrides | null> {
  if (file === null) {
    return {};
  }
  try {
    const parsed = parseEntriesFile(await readFile(file, 'utf8'));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseSupervisorArgs(argv);
  if (!args.ok) {
    stderrLine(`usage_error:${args.error.reason}`);
    return EXIT_USAGE;
  }
  const a = args.value;
  const entries = await loadEntries(a.entries);
  if (entries === null) {
    stderrLine('usage_error:entries_unreadable');
    return EXIT_USAGE;
  }
  const appRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const bundle = await readBundleInfo(appRoot, a.runtime);
  await ensureRunDirs(a.home);
  const bootId = ulid();
  const lock = await acquireLock(a.home, {
    pid: process.pid,
    boot_id: bootId,
    version: bundle.appVersion,
    started_at: systemClock.now(),
    profile: a.profile,
  });
  if (!lock.acquired) {
    stderrLine('already_running');
    return EXIT_BUSY;
  }
  const sink = createLogSink({
    home: a.home,
    clock: systemClock,
    foreground: a.foreground,
    onError: (what, e) => log.warn({ event: 'supervisor.log_sink.failed', what, err: e }, 'log sink error'),
  });
  const log = createLogger('supervisor', {
    level: a.logLevel,
    bootId,
    clock: systemClock,
    destination: { write: (chunk: string): void => sink.line('supervisor', 'stdout', chunk.trimEnd()) },
  });
  const files = createRuntimeFiles(a.home, {
    onError: (what, e) =>
      log.error({ event: 'supervisor.runtime_file.failed', what, err: e }, 'runtime file write failed'),
  });
  const supervisor = createSupervisor(
    {
      profile: a.profile,
      home: a.home,
      bundle,
      bootId,
      safeMode: a.safe,
      foreground: a.foreground,
      logLevel: a.logLevel,
      entries,
      previousCrashed: lock.previousCrashed,
    },
    {
      clock: systemClock,
      timers: {
        after(ms, fn): () => void {
          const t = setTimeout(fn, ms);
          return (): void => clearTimeout(t);
        },
      },
      spawnChild: realSpawnChild(),
      randomBytes: (n) => randomBytes(n),
      files,
      sink,
      log,
      env: readAllowedEnv,
      platform: process.platform,
      watch: a.profile === 'dev' ? realDevWatch : undefined,
    },
  );
  const fatal = (e: unknown): void => {
    log.fatal({ event: 'supervisor.fatal', err: e }, 'supervisor internal error');
    process.exit(EXIT_SOFTWARE);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
  const onSignal = (): void => {
    supervisor.shutdownAll(SHUTDOWN_GRACE_MS).catch(fatal);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const keepAlive = setInterval(() => undefined, 60_000);
  await sink.sweep();
  log.info({ event: 'supervisor.start', profile: a.profile, runtime: a.runtime, safe: a.safe }, 'supervisor start');
  await supervisor.start();
  const code = await supervisor.done;
  clearInterval(keepAlive);
  return code;
}

let exitCode = EXIT_SOFTWARE;
try {
  exitCode = await main(process.argv.slice(2));
} catch (e) {
  stderrLine(`internal_error:${e instanceof Error ? e.name : 'unknown'}`);
}
process.exit(exitCode);
