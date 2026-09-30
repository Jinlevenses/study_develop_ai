import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(here, '..', 'node_modules', '.bin', 'tsx');

export function runWarnings(workDir) {
  const dir = join(workDir, 'warn');
  mkdirSync(dir, { recursive: true });
  const W = (name, body) => { const p = join(dir, name); writeFileSync(p, body); return p; };

  const P = {
    plain: W('plain.mjs', `import { DatabaseSync } from 'node:sqlite'; new DatabaseSync(':memory:').close(); console.log('OK');`),
    cjs: W('plain.cjs', `const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close(); console.log('OK');`),
    ts: W('plain.ts', `import { DatabaseSync } from 'node:sqlite'; const n: number = 1; new DatabaseSync(':memory:').close(); console.log('OK', n);`),
    handler: W('handler.mjs', `const seen=[]; process.on('warning', (w)=>seen.push(w.name)); const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(':memory:').close(); await new Promise(r=>setImmediate(r)); console.log('OK handler_saw=' + JSON.stringify(seen));`),
    removeAll: W('removeAll.mjs', `process.removeAllListeners('warning'); const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(':memory:').close(); console.log('OK');`),
    emitOverride: W('emitOverride.mjs', `const orig = process.emitWarning.bind(process);
process.emitWarning = (w, ...a) => { const type = typeof a[0] === 'string' ? a[0] : a[0]?.type; if (type === 'ExperimentalWarning') return; return orig(w, ...a); };
const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(':memory:').close(); console.log('OK');`),
    staticImportWithHandler: W('staticImportWithHandler.mjs', `process.on('warning', () => {}); import { DatabaseSync } from 'node:sqlite'; new DatabaseSync(':memory:').close(); console.log('OK');`),
    forkParent: W('forkParent.mjs', `import { fork } from 'node:child_process'; const c = fork(new URL('./plain.mjs', import.meta.url)); c.on('exit', () => {});`),
    spawnParent: W('spawnParent.mjs', `import { spawn } from 'node:child_process'; spawn(process.execPath, [new URL('./plain.mjs', import.meta.url).pathname], { stdio: 'inherit' });`),
    workerParent: W('workerParent.mjs', `import { Worker } from 'node:worker_threads'; new Worker(new URL('./plain.mjs', import.meta.url));`),
    shebang: W('shebang.mjs', `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning\nimport { DatabaseSync } from 'node:sqlite'; new DatabaseSync(':memory:').close(); console.log('OK');`),
  };
  chmodSync(P.shebang, 0o755);

  const run = (label, cmd, args, env = {}) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, timeout: 30000 });
    const warnLines = (r.stderr.match(/ExperimentalWarning[^\n]*/g) ?? []);
    return {
      label, command: [cmd === process.execPath ? 'node' : cmd.replace(here + '/..', '.'), ...args.map((a) => a.replace(dir, '<dir>'))].join(' ') + (Object.keys(env).length ? `   [env ${Object.entries(env).map(([k, v]) => k + '=' + v).join(' ')}]` : ''),
      exit: r.status, stdout: r.stdout.trim().slice(0, 120), warning_printed: warnLines.length > 0, warning_count: warnLines.length,
      stderr_head: r.stderr.trim().split('\n')[0]?.slice(0, 140) ?? '',
    };
  };
  const N = process.execPath, D = '--disable-warning=ExperimentalWarning';
  const cases = [
    run('1 default (no flag)', N, [P.plain]),
    run('2 --disable-warning=ExperimentalWarning', N, [D, P.plain]),
    run('3 --disable-warning=ExperimentalWarning (CJS require)', N, [D, P.cjs]),
    run('4 --no-warnings', N, ['--no-warnings', P.plain]),
    run('5 NODE_OPTIONS=--disable-warning=ExperimentalWarning', N, [P.plain], { NODE_OPTIONS: D }),
    run('6 NODE_NO_WARNINGS=1', N, [P.plain], { NODE_NO_WARNINGS: '1' }),
    run("7 process.on('warning') handler only (dynamic import)", N, [P.handler]),
    run("8 process.on('warning') + static import", N, [P.staticImportWithHandler]),
    run("9 process.removeAllListeners('warning') then dynamic import", N, [P.removeAll]),
    run('10 process.emitWarning override then dynamic import', N, [P.emitOverride]),
    run('11 flag typo --disable-warning=Experimental', N, ['--disable-warning=Experimental', P.plain]),
    run('12 tsx, default', TSX, [P.ts]),
    run('13 tsx --disable-warning=ExperimentalWarning', TSX, [D, P.ts]),
    run('14 node --disable-warning=... --import tsx file.ts', N, [D, '--import', 'tsx', P.ts]),
    run('15 NODE_OPTIONS via tsx', TSX, [P.ts], { NODE_OPTIONS: D }),
    run('16 fork(): parent has --disable-warning (execArgv inherited?)', N, [D, P.forkParent]),
    run('17 spawn(process.execPath): parent has flag, child gets no flag', N, [D, P.spawnParent]),
    run('18 spawn(): parent has NODE_OPTIONS (env inherited)', N, [P.spawnParent], { NODE_OPTIONS: D }),
    run('19 worker_threads: parent has --disable-warning', N, [D, P.workerParent]),
    run('20 worker_threads: no flag', N, [P.workerParent]),
    run('21 shebang env -S node --disable-warning', P.shebang, []),
  ];
  return { node: process.version, cases };
}
