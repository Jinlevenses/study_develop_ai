// Preload guard (node --import). Runs BEFORE learner code, inside the sandboxed child.
// Layers implemented here (Node's --permission does NOT cover network, sqlite ATTACH, process.kill):
//  1. module.registerHooks resolve hook: default-DENY builtin allowlist (covers import, require, createRequire,
//     Module._load, dynamic import, data: URL imports). Decision is made on the RESOLVED url (node:xxx), so
//     spelling tricks ('NET', 'net/', 'node:net?x') cannot bypass.
//  2. process.getBuiltinModule wrapped with the same allowlist.
//  3. globalThis.fetch / WebSocket / EventSource replaced by throwing stubs (undici uses internal net).
//  4. net.Socket.prototype.connect / net.Server.prototype.listen neutered (stdout/stdin pipes ARE net.Socket,
//     so `new process.stdout.constructor().connect()` would otherwise be a network path).
//  5. process.binding/_linkedBinding/dlopen/setuid*/kill(other pid)/_kill blocked.
//  6. Self-destruct timer (unref) as a second wall-clock defence if the parent dies.
// Config comes from two env vars set by the parent; they are deleted immediately so learner code sees an empty env.
import Module, { registerHooks } from 'node:module';
import net from 'node:net';

const MODE = process.env.FATHOM_MODE === 'sql' ? 'sql' : 'js';
const DEADLINE_MS = Number(process.env.FATHOM_DEADLINE_MS) || 0;
delete process.env.FATHOM_MODE;
delete process.env.FATHOM_DEADLINE_MS;

// default-deny allowlist of builtin modules for learner code.
const ALLOW_JS = new Set([
  'assert', 'assert/strict', 'buffer', 'console', 'crypto', 'events', 'fs', 'fs/promises', 'path', 'path/posix',
  'path/win32', 'perf_hooks', 'process', 'querystring', 'readline', 'readline/promises', 'stream', 'stream/promises',
  'stream/web', 'stream/consumers', 'string_decoder', 'timers', 'timers/promises', 'url', 'util', 'util/types',
  'zlib', 'async_hooks', 'punycode', 'test', 'diagnostics_channel',
]);
// Explicitly denied (documented, all covered by default-deny): net dgram dns dns/promises http https http2 tls
// inspector inspector/promises child_process worker_threads cluster vm v8 repl module wasi os tty trace_events
// sqlite (node:sqlite ATTACH / VACUUM INTO bypass --permission), sea, domain, readline is allowed.
const ALLOW = new Set(ALLOW_JS);
if (MODE === 'sql') ALLOW.add('sqlite');

function blocked(name) {
  const e = new Error(`Access to module '${name}' is blocked by the Fathom runner`);
  e.code = 'ERR_FATHOM_BLOCKED';
  return e;
}
function builtinBase(url) {
  // url like 'node:net' or 'node:dns/promises'
  return url.slice(5);
}
function check(name) {
  const n = String(name).replace(/^node:/, '');
  if (!ALLOW.has(n)) throw blocked(name);
}

// 1. resolve hook (sync hooks apply to both ESM and CJS in Node >= 22.15)
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    if (typeof r.url === 'string' && r.url.startsWith('node:')) {
      if (!ALLOW.has(builtinBase(r.url))) throw blocked(specifier);
    }
    return r;
  },
});

// 2. getBuiltinModule
const origGBM = process.getBuiltinModule?.bind(process);
if (origGBM) {
  Object.defineProperty(process, 'getBuiltinModule', {
    value: function getBuiltinModule(id) { check(id); return origGBM(id); },
    writable: false, configurable: false,
  });
}

// 3. web network globals
for (const k of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  const stub = function () { throw blocked(k); };
  delete globalThis[k]; // delete first: defineProperty on the lazy getter would load undici (+wasm) for nothing
  Object.defineProperty(globalThis, k, { value: stub, writable: false, configurable: false, enumerable: false });
}

// 4. neuter net.Socket / net.Server (stdio pipes are net.Socket instances)
const deny = (n) => function () { throw blocked(n); };
Object.defineProperty(net.Socket.prototype, 'connect', { value: deny('net.Socket.connect'), writable: false, configurable: false });
Object.defineProperty(net.Server.prototype, 'listen', { value: deny('net.Server.listen'), writable: false, configurable: false });

// 5. process hardening
const lock = (k, v) => Object.defineProperty(process, k, { value: v, writable: false, configurable: false });
for (const k of ['binding', '_linkedBinding', 'dlopen', 'setuid', 'setgid', 'seteuid', 'setegid', 'setgroups', 'initgroups', 'execve', '_debugProcess', '_debugEnd', '_startProfilerIdleNotifier']) {
  if (k in process) lock(k, deny('process.' + k));
}
const selfPid = process.pid;
const origKill = process.kill.bind(process);
lock('kill', function kill(pid, sig) {
  if (Number(pid) !== selfPid) throw blocked('process.kill(other pid)');
  return origKill(pid, sig);
});
if ('_kill' in process) lock('_kill', deny('process._kill'));
// diagnostic report leaks hostname / cwd / execPath / cpu info (not blocked by --permission for getReport)
try { for (const k of ['getReport', 'writeReport']) Object.defineProperty(process.report, k, { value: deny('process.report.' + k), writable: false, configurable: false }); } catch {}
try { process.execArgv.length = 0; } catch {} // hide runner flag/paths from learner code
// Freeze process.env view (already empty)
// 6. self-destruct
if (DEADLINE_MS > 0) {
  const t = setTimeout(() => { origKill(selfPid, 'SIGKILL'); }, DEADLINE_MS);
  t.unref();
}
void Module;
