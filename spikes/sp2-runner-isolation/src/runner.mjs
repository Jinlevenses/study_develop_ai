// Runner: one sandboxed child per request. See report SP-2.md for the rationale of every flag.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSql } from './sql-tokenizer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GUARD = path.join(HERE, 'guard.mjs');
export const SQL_ENTRY = path.join(HERE, 'sql-entry.mjs');
export const SQL_TOKENIZER = path.join(HERE, 'sql-tokenizer.mjs');
export const WARM_ENTRY = path.join(HERE, 'warm-entry.mjs');
export const RUN_ROOT = path.join(os.tmpdir(), 'fathom-runner');

const live = new Set();
process.on('exit', () => { for (const pid of live) { try { process.kill(-pid, 'SIGKILL'); } catch {} } });

function readRssKB(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(s);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

/**
 * opts: { code, lang: 'js'|'ts'|'cjs' | sql, kind: 'code'|'sql', timeoutMs=3000, rssLimitMB=256, outCapBytes=65536,
 *         watchIntervalMs=100, layers: 'full'|'permission'|'none', writableTmp=false, asMB=1536, cpuSec, fsizeMB=8,
 *         extraFiles: {name: content}, env: {} (extra parent-chosen env; default empty), unsafeNoTokenizer }
 */
export const DEFAULTS = {
  kind: 'code', lang: 'js', timeoutMs: 3000, rssLimitMB: 256, outCapBytes: 65536, watchIntervalMs: 100,
  layers: 'full', writableTmp: false, asMB: 1536, fsizeMB: 8, maxOldSpaceMB: 128, extraFiles: {}, env: {},
};

/** Creates the temp cwd and spawns the sandboxed node. warm=true: spare child that waits for "go\n" on stdin (JS only). */
export function spawnSandbox(opts) {
  const o = { ...DEFAULTS, ...opts };
  fs.mkdirSync(RUN_ROOT, { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(path.join(RUN_ROOT, 'run-'));
  const ext = o.lang === 'ts' ? 'mts' : o.lang === 'cjs' ? 'cjs' : 'mjs';
  let entry;
  const nodeArgs = [];
  const entryArgs = [];
  if (o.warm) {
    entry = WARM_ENTRY; entryArgs.push(path.join(tmp, 'main.mjs'));
  } else if (o.kind === 'sql') {
    fs.writeFileSync(path.join(tmp, 'query.sql'), o.code);
    entry = SQL_ENTRY; entryArgs.push(path.join(tmp, 'query.sql'));
    if (o.unsafeNoTokenizer) entryArgs.push('--unsafe-no-tokenizer');
  } else {
    entry = path.join(tmp, `main.${ext}`);
    fs.writeFileSync(entry, o.code);
  }
  for (const [name, content] of Object.entries(o.extraFiles)) fs.writeFileSync(path.join(tmp, name), content);

  const layers = o.layers;
  if (layers !== 'none') {
    nodeArgs.push('--permission');
    // fs read: ONLY the preload guard, the tmp dir (learner file + inputs), and (sql/warm) the trusted entry.
    nodeArgs.push(`--allow-fs-read=${GUARD}`);
    if (o.kind === 'sql') nodeArgs.push(`--allow-fs-read=${SQL_ENTRY}`, `--allow-fs-read=${SQL_TOKENIZER}`);
    if (o.warm) nodeArgs.push(`--allow-fs-read=${WARM_ENTRY}`);
    nodeArgs.push(`--allow-fs-read=${tmp}`);
    if (o.writableTmp) nodeArgs.push(`--allow-fs-write=${tmp}`);
    // NOT granted: --allow-child-process --allow-worker --allow-addons --allow-wasi
    nodeArgs.push('--disallow-code-generation-from-strings');
  }
  nodeArgs.push(`--max-old-space-size=${o.maxOldSpaceMB}`, '--disable-warning=ExperimentalWarning', '--no-addons');
  // wasm trap handler reserves ~10GB virtual per wasm memory; it breaks under RLIMIT_AS and is needed by type stripping (amaro).
  if (process.platform === 'linux') nodeArgs.push('--disable-wasm-trap-handler');
  if (layers === 'full') nodeArgs.push(`--import=${pathToFileURL(GUARD).href}`);
  nodeArgs.push(entry, ...entryArgs);

  // OS backstops (Linux): virtual memory, CPU seconds, max file size. prlimit execs the target so pid == node pid.
  let cmd = process.execPath;
  let args = nodeArgs;
  const useRlimit = process.platform === 'linux' && layers !== 'none' && o.asMB > 0;
  if (useRlimit) {
    const cpu = o.cpuSec ?? Math.ceil(o.timeoutMs / 1000) + 1;
    args = [`--as=${o.asMB * 1024 * 1024}`, `--cpu=${cpu}`, `--fsize=${o.fsizeMB * 1024 * 1024}`, '--core=0', '--', process.execPath, ...nodeArgs];
    cmd = 'prlimit';
  }

  if (o.netns && process.platform === 'linux') { // optional hardening: empty network namespace (works unprivileged where user namespaces are enabled)
    args = ['-Urn', '--', cmd, ...args]; cmd = 'unshare';
  }

  const env = { ...o.env };                      // minimal env: EMPTY by default (no PATH, HOME, tokens)
  if (layers === 'full') { env.FATHOM_MODE = o.kind === 'sql' ? 'sql' : 'js'; env.FATHOM_DEADLINE_MS = String(o.timeoutMs + 500 + (o.warm ? 60000 : 0)); }

  const child = spawn(cmd, args, { cwd: tmp, env, stdio: [o.warm ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true, windowsHide: true });
  live.add(child.pid);
  return { child, tmp, o };
}

/** Attaches watchers (timeout, RSS, output caps), waits for exit, cleans tmp. */
export async function collect({ child, tmp, o }, t0 = performance.now()) {
  const res = { status: 'ok', stdout: '', stderr: '', exitCode: null, signal: null, timedOut: false, killedBy: null, peakRssMB: 0, outputTruncated: false, spawned: true, pid: child.pid };
  let outBytes = 0, errBytes = 0;
  const cap = o.outCapBytes;
  const kill = (why) => {
    if (res.killedBy) return;
    res.killedBy = why;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  };
  const take = (which) => (buf) => {
    if (which === 'out') { const room = cap - outBytes; if (room > 0) res.stdout += buf.subarray(0, room).toString('utf8'); outBytes += buf.length; if (outBytes >= cap) { res.outputTruncated = true; kill('output_limit'); } }
    else { const room = cap - errBytes; if (room > 0) res.stderr += buf.subarray(0, room).toString('utf8'); errBytes += buf.length; if (errBytes >= cap) { res.outputTruncated = true; kill('output_limit'); } }
  };
  child.stdout.on('data', take('out'));
  child.stderr.on('data', take('err'));

  const timer = setTimeout(() => { res.timedOut = true; kill('timeout'); }, o.timeoutMs);
  const rssLimitKB = o.rssLimitMB * 1024;
  const watch = setInterval(() => {
    const kb = readRssKB(child.pid);
    if (kb != null) {
      res.peakRssMB = Math.max(res.peakRssMB, +(kb / 1024).toFixed(1));
      if (kb > rssLimitKB) kill('rss_limit');
    }
  }, o.watchIntervalMs);

  const exit = await new Promise((resolve) => {
    child.on('error', (e) => { res.spawnError = String(e.message); resolve({ code: null, signal: null }); });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer); clearInterval(watch); live.delete(child.pid);
  // make sure no descendant survived (there should be none: child_process is denied)
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  res.exitCode = exit.code; res.signal = exit.signal;
  if (res.killedBy === 'timeout') res.status = 'timeout';
  else if (res.killedBy === 'rss_limit') res.status = 'memory_limit';
  else if (res.killedBy === 'output_limit') res.status = 'output_limit';
  else if (exit.signal === 'SIGABRT' && /heap out of memory|Allocation failed|OOM/i.test(res.stderr)) res.status = 'memory_limit'; // V8 hit --max-old-space-size first
  else if (exit.signal) res.status = 'killed_' + exit.signal;
  else if (exit.code !== 0) res.status = 'error';
  res.durationMs = +(performance.now() - t0).toFixed(1);
  try { fs.rmSync(tmp, { recursive: true, force: true }); res.tmpCleaned = !fs.existsSync(tmp); } catch { res.tmpCleaned = false; }
  return res;
}

export async function run(opts) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = performance.now();
  if (o.kind === 'sql' && !o.unsafeNoTokenizer) {
    try { checkSql(o.code); } catch (e) {
      return { status: 'rejected', reason: e.reason ?? e.message, stdout: '', stderr: '', exitCode: null, signal: null, timedOut: false, durationMs: +(performance.now() - t0).toFixed(1), spawned: false };
    }
  }
  return collect(spawnSandbox(o), t0);
}

/** One-shot pre-warmed spare (experiment for the pre-fork question). Spare is used exactly once, never reused. */
export function prewarm(opts = {}) { return spawnSandbox({ ...opts, warm: true }); }
export async function runOnSpare(spare, code) {
  const t0 = performance.now();
  fs.writeFileSync(path.join(spare.tmp, 'main.mjs'), code);
  spare.child.stdin.write('go\n');
  spare.child.stdin.end();
  return collect(spare, t0);
}
