import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EnvDeps } from './cli-env.js';
import { supervisorEnv } from './cli-env.js';
import type { Launched, LaunchOptions } from './deps.js';

// ADR-012 §1·§6 · Brief §4.2.5 — supervisor는 **파일 경로로 spawn**한다(import 0). `node:child_process`를 쓰는 이 단위의 유일한 파일(STD-TS-40).
const WARNING = '--disable-warning=ExperimentalWarning';
const SRC_EXEC_ARGV = [WARNING, '--import', 'tsx', '--conditions=source'] as const;
const DIST_EXEC_ARGV = [WARNING] as const;

export type LaunchSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: {
    readonly cwd: string;
    readonly env: Record<string, string>;
    readonly detached: boolean;
    readonly stdio: 'inherit' | 'ignore';
    readonly windowsHide: true;
    readonly shell: false;
  };
};

function inRoot(appRoot: string, relative: string): string {
  const base = pathToFileURL(appRoot.endsWith(path.sep) ? appRoot : `${appRoot}${path.sep}`);
  return fileURLToPath(new URL(relative, base));
}

/** 순수: spawn에 넘길 사양. `detached`는 foreground가 아닐 때만(CLI가 끝나도 supervisor가 산다). */
export function buildLaunchSpec(o: LaunchOptions, env: EnvDeps, execPath: string): LaunchSpec {
  const src = o.runtime === 'src';
  const entry = inRoot(o.appRoot, src ? 'services/ops/src/supervisor/main.ts' : 'services/ops/dist/supervisor/main.js');
  const args = [
    ...(src ? SRC_EXEC_ARGV : DIST_EXEC_ARGV),
    entry,
    `--profile=${o.profile}`,
    `--home=${o.home}`,
    `--runtime=${o.runtime}`,
    ...(o.safe ? ['--safe'] : []),
    ...(o.foreground ? ['--foreground'] : []),
    `--log-level=${o.logLevel}`,
    ...(o.entries === null ? [] : [`--entries=${o.entries}`]),
  ];
  return {
    command: execPath,
    args,
    options: {
      cwd: o.appRoot,
      env: supervisorEnv(o.home, env),
      detached: !o.foreground,
      stdio: o.foreground ? 'inherit' : 'ignore',
      windowsHide: true,
      shell: false,
    },
  };
}

export function launchSupervisor(o: LaunchOptions, env: EnvDeps): Launched {
  const spec = buildLaunchSpec(o, env, process.execPath);
  const child: ChildProcess = spawn(spec.command, [...spec.args], { ...spec.options, env: { ...spec.options.env } });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(null));
  });
  if (spec.options.detached) {
    child.unref();
  }
  if (child.pid === undefined) {
    throw new Error('invariant: supervisor spawn returned no pid');
  }
  return { pid: child.pid, exited };
}
