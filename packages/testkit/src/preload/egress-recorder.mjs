// egress 기록기(TST-01 §8.2·§8.3 L1) — `node --import <이 파일>`로 싣는 ESM, 의존성 0.
// 비 loopback 연결·DNS·fetch와 비 node 바이너리 spawn을 `<FATHOM_HOME>/tmp/egress/<pid>.jsonl`에 한 줄 JSON으로 남긴다.
// 테스트 전용 env(제품 코드 env 표 STD-01 §8.3 범위 밖, testkit 안에서만 읽음):
//   FATHOM_EGRESS_MODE = record(기본) | block   — block이면 기록 후 연결은 ECONNREFUSED, DNS는 ENOTFOUND로 비동기 실패(spawn은 기록만)
//   FATHOM_HOME        — 없으면 <os.tmpdir()>/fathom-egress/ 에 기록
// preload이므로 패치 설치(최상위 부작용)와 동기 appendFileSync를 허용한다.
import childProcess from 'node:child_process';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import module from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const INSTALLED = Symbol.for('fathom.egress-recorder.installed');
// child_process는 boundaries.json `builtin_restricted`(CR-72: `packages/testkit/src/preload/**` 허용) 대상이다.
// 이 파일은 spawn하지 않고 감쌀 뿐이다. 기본 import = CJS exports 객체이므로 아래 패치가 모든 소비자에게 보인다.

function install() {
  const block = process.env.FATHOM_EGRESS_MODE === 'block';
  const home = process.env.FATHOM_HOME;
  const dir = home ? path.join(home, 'tmp', 'egress') : path.join(os.tmpdir(), 'fathom-egress');
  const file = path.join(dir, `${process.pid}.jsonl`);
  let dirReady = false;

  const frames = () => {
    const stack = new Error().stack ?? '';
    return stack
      .split('\n')
      .slice(1)
      .filter((line) => !line.includes('egress-recorder.mjs'))
      .slice(0, 5)
      .map((line) => line.trim());
  };

  const record = (kind, target, blocked) => {
    if (!dirReady) {
      fs.mkdirSync(dir, { recursive: true });
      dirReady = true;
    }
    const line = JSON.stringify({ ts: Date.now(), pid: process.pid, kind, target, blocked, stack: frames() });
    fs.appendFileSync(file, `${line}\n`);
  };

  const stripBrackets = (host) => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);
  const isLoopbackHost = (rawHost) => {
    if (rawHost === undefined || rawHost === null || rawHost === '') {
      return true; // Node 기본 host = localhost
    }
    const host = stripBrackets(String(rawHost)).toLowerCase().replace(/\.$/, '');
    return (
      host === 'localhost' ||
      host === '::1' ||
      /^127(\.\d{1,3}){3}$/.test(host) ||
      /^::ffff:127(\.\d{1,3}){3}$/.test(host)
    );
  };
  const isIpLiteral = (host) => net.isIP(stripBrackets(String(host))) !== 0;

  const refused = (host, port) =>
    Object.assign(new Error(`connect ECONNREFUSED ${host}:${port}`), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: host,
      port,
    });
  const notFound = (host) =>
    Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
      code: 'ENOTFOUND',
      errno: -3008,
      syscall: 'getaddrinfo',
      hostname: host,
    });

  // --- net.Socket.prototype.connect ---
  const originalConnect = net.Socket.prototype.connect;
  const parseConnectArgs = (args) => {
    const first = args[0];
    if (Array.isArray(first)) {
      return parseConnectArgs(first); // net.Socket normalizeArgs 결과 형태
    }
    if (first !== null && typeof first === 'object') {
      if (first.path !== undefined) {
        return { local: true, host: '', port: 0 };
      }
      return { local: false, host: first.host ?? 'localhost', port: first.port ?? 0 };
    }
    if (typeof first === 'string' && !/^\d+$/.test(first)) {
      return { local: true, host: '', port: 0 }; // unix 소켓 경로(IPC)
    }
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { local: false, host, port: Number(first) };
  };
  net.Socket.prototype.connect = function patchedConnect(...args) {
    const target = parseConnectArgs(args);
    if (target.local || isLoopbackHost(target.host)) {
      return originalConnect.apply(this, args);
    }
    record('connect', `${target.host}:${target.port}`, block);
    if (!block) {
      return originalConnect.apply(this, args);
    }
    const failure = refused(target.host, target.port);
    process.nextTick(() => this.destroy(failure));
    return this;
  };

  // --- tls.connect (기록만; 실제 소켓 연결은 위 패치가 차단) ---
  const originalTlsConnect = tls.connect;
  tls.connect = function patchedTlsConnect(...args) {
    const first = args[0];
    let host;
    let port;
    if (first !== null && typeof first === 'object') {
      host = first.host ?? first.servername ?? 'localhost';
      port = first.port ?? 443;
    } else {
      port = first;
      host = typeof args[1] === 'string' ? args[1] : 'localhost';
    }
    if (!isLoopbackHost(host)) {
      record('tls', `${host}:${port}`, block);
    }
    return originalTlsConnect.apply(this, args);
  };

  // --- dns.lookup / dns.promises.lookup ---
  const originalLookup = dns.lookup;
  const patchedLookup = function patchedLookup(hostname, ...rest) {
    if (typeof hostname !== 'string' || isLoopbackHost(hostname) || isIpLiteral(hostname)) {
      return originalLookup.call(this, hostname, ...rest);
    }
    record('dns', hostname, block);
    if (!block) {
      return originalLookup.call(this, hostname, ...rest);
    }
    const callback = rest.find((arg) => typeof arg === 'function');
    process.nextTick(() => callback?.(notFound(hostname)));
    return {};
  };
  Object.assign(patchedLookup, originalLookup); // __promisify__ 등 보존
  dns.lookup = patchedLookup;
  const originalPromiseLookup = dnsPromises.lookup;
  dnsPromises.lookup = function patchedPromiseLookup(hostname, ...rest) {
    if (typeof hostname !== 'string' || isLoopbackHost(hostname) || isIpLiteral(hostname)) {
      return originalPromiseLookup.call(this, hostname, ...rest);
    }
    record('dns', hostname, block);
    if (!block) {
      return originalPromiseLookup.call(this, hostname, ...rest);
    }
    return Promise.reject(notFound(hostname));
  };
  dns.promises.lookup = dnsPromises.lookup;

  // --- fetch ---
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = function patchedFetch(input, init) {
      let href;
      try {
        href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      } catch {
        href = undefined;
      }
      let host;
      try {
        host = href === undefined ? undefined : new URL(href).hostname;
      } catch {
        host = undefined;
      }
      if (host !== undefined && !isLoopbackHost(host)) {
        record('fetch', href, block);
        if (block) {
          return Promise.reject(new TypeError('fetch failed', { cause: refused(host, 0) }));
        }
      }
      return originalFetch.call(this, input, init);
    };
  }

  // --- child_process ---
  const isNodeBinary = (file) => {
    if (typeof file !== 'string') {
      return true;
    }
    const base = path.basename(file).toLowerCase();
    return file === process.execPath || base === 'node' || base === 'node.exe';
  };
  const wrapSpawn = (name) => {
    const original = childProcess[name];
    if (typeof original !== 'function') {
      return;
    }
    childProcess[name] = function patchedSpawn(...args) {
      const file = typeof args[0] === 'string' ? args[0] : undefined;
      if (!isNodeBinary(file)) {
        record('spawn', file, false);
      }
      return original.apply(this, args);
    };
  };
  // fork는 항상 node(process.execPath)를 띄우므로 기록 대상이 아니다. exec·execSync는 셸 명령 문자열이라 셸 자체(`/bin/sh`)로 기록한다.
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    wrapSpawn(name);
  }
  for (const name of ['exec', 'execSync']) {
    const original = childProcess[name];
    childProcess[name] = function patchedExec(...args) {
      // 명령 문자열(토큰 등 비밀이 들어갈 수 있다)은 기록하지 않고 셸만 남긴다.
      const shellOption = args[1] !== null && typeof args[1] === 'object' ? args[1].shell : undefined;
      const shell =
        typeof shellOption === 'string' ? shellOption : process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      if (typeof args[0] === 'string') {
        record('spawn', shell, false);
      }
      return original.apply(this, args);
    };
  }
  const originalFork = childProcess.fork;
  childProcess.fork = function patchedFork(...args) {
    const execPath = args[1]?.execPath ?? args[2]?.execPath;
    if (typeof execPath === 'string' && !isNodeBinary(execPath)) {
      record('spawn', execPath, false);
    }
    return originalFork.apply(this, args);
  };

  module.syncBuiltinESMExports();
}

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
  install();
}
