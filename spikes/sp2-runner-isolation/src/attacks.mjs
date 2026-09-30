// Escape / abuse attempt catalogue (>= 20). Each attack is learner-style code run in the sandbox.
// Convention: payload prints "ESCAPED:<detail>" when the forbidden capability worked, "BLOCKED:<code>" otherwise.
// The harness ALSO checks host-side effects (files, sockets, signals, canary leaks) independent of stdout.
const P = `const T=async(f)=>{try{const r=await f();console.log('ESCAPED:'+String(r).slice(0,80))}catch(e){console.log('BLOCKED:'+(e&&(e.code||e.name)))}};\n`;

export const attacks = (c) => [
  // ---------------- filesystem ----------------
  { id: 'FS-01', cat: 'fs', name: 'read ~/.ssh (canary key + real home dir)', code: P + `import fs from 'node:fs';
await T(()=>fs.readFileSync('${c.fakeHome}/.ssh/id_rsa','utf8'));
await T(()=>fs.readdirSync('${c.realHome}/.ssh').length+' entries');` },
  { id: 'FS-02', cat: 'fs', name: 'read /etc/passwd, /etc/hostname', code: P + `import fs from 'node:fs';
await T(()=>fs.readFileSync('/etc/passwd','utf8'));
await T(()=>fs.readFileSync('/etc/hostname','utf8'));` },
  { id: 'FS-03', cat: 'fs', name: 'read /proc/self/environ and /proc/<ppid>/environ (parent secrets)', code: P + `import fs from 'node:fs';
await T(()=>fs.readFileSync('/proc/self/environ','utf8').length);
await T(()=>fs.readFileSync('/proc/'+process.ppid+'/environ','utf8').includes('${c.secretName}'));
await T(()=>fs.readFileSync('/proc/'+process.ppid+'/cmdline','utf8'));` },
  { id: 'FS-04', cat: 'fs', name: 'write file outside temp (absolute path)', code: P + `import fs from 'node:fs';
await T(()=>fs.writeFileSync('${c.outside}/pwn.txt','pwned'));
await T(async()=>{await fs.promises.writeFile('${c.outside}/pwn2.txt','pwned'); return 'promises'});` },
  { id: 'FS-05', cat: 'fs', name: 'write outside via relative ../ from cwd + mkdir + rename', code: P + `import fs from 'node:fs';
await T(()=>fs.writeFileSync('../pwn-rel.txt','pwned'));
await T(()=>fs.mkdirSync('../pwn-dir'));
await T(()=>fs.appendFileSync('${c.outside}/append.txt','x'));` },
  { id: 'FS-06', cat: 'fs', name: 'list sibling run dirs, /, tmp root', code: P + `import fs from 'node:fs';
await T(()=>fs.readdirSync('..').join(','));
await T(()=>fs.readdirSync('/').length);
await T(()=>fs.readdirSync('${c.runRoot}').length);` },
  { id: 'FS-07', cat: 'fs', name: 'path traversal / proc root tricks to reach /etc', code: P + `import fs from 'node:fs';
await T(()=>fs.readFileSync('../../../../../../../../etc/passwd','utf8').length);
await T(()=>fs.readFileSync('/proc/self/root/etc/passwd','utf8').length);
await T(()=>fs.readFileSync('/proc/self/cwd/../../../../etc/hostname','utf8').length);
await T(()=>fs.readFileSync('${c.runRoot}/../../etc/hostname','utf8').length);` },
  { id: 'FS-08', cat: 'fs', name: 'process.chdir(/) then read relative', code: P + `import fs from 'node:fs';
await T(()=>{process.chdir('/'); return fs.readFileSync('etc/passwd','utf8').length});` },
  { id: 'FS-09', cat: 'fs', name: 'symlink/hardlink escape from WRITABLE tmp', opts: { writableTmp: true }, code: P + `import fs from 'node:fs';
await T(()=>{fs.symlinkSync('${c.fakeHome}/.ssh/id_rsa','link'); return fs.readFileSync('link','utf8')});
await T(()=>{fs.symlinkSync('${c.fakeHome}/.ssh','dirlink'); return fs.readFileSync('dirlink/id_rsa','utf8')});
await T(()=>{fs.linkSync('${c.fakeHome}/.ssh/id_rsa','hard'); return fs.readFileSync('hard','utf8')});
await T(()=>{fs.symlinkSync('${c.outside}','outlink'); fs.writeFileSync('outlink/via-symlink.txt','x'); return 'wrote'});` },
  { id: 'FS-10', cat: 'fs', name: 'writable tmp: write inside OK, outside/../ blocked, 50MB disk fill capped', opts: { writableTmp: true, fsizeMB: 8 }, allowOk: true, code: P + `import fs from 'node:fs';
fs.writeFileSync('inside.txt','ok'); console.log('INSIDE-WRITE-OK');
await T(()=>fs.writeFileSync('../outside-of-tmp.txt','x'));
await T(()=>fs.writeFileSync('${c.outside}/w.txt','x'));
await T(()=>{fs.writeFileSync('big.bin', Buffer.alloc(50*1024*1024,1)); return fs.statSync('big.bin').size});` },
  { id: 'FS-11', cat: 'fs', name: 'process.report.writeReport outside', code: P + `await T(()=>process.report.writeReport('${c.outside}/report.json'));` },
  { id: 'FS-12', cat: 'fs', name: 'JS uses node:sqlite ATTACH / VACUUM INTO to create files (permission bypass)', code: P + `const {DatabaseSync}=await import('node:sqlite');
const d=new DatabaseSync(':memory:',{allowExtension:false});
await T(()=>{d.exec("ATTACH DATABASE '${c.outside}/js-attach.db' AS x; CREATE TABLE x.t(a)"); return 'attached'});
await T(()=>{d.exec("VACUUM INTO '${c.outside}/js-vacuum.db'"); return 'vacuumed'});` },

  // ---------------- process ----------------
  { id: 'PR-01', cat: 'process', name: 'child_process.spawnSync via dynamic import', code: P + `await T(async()=>{const cp=await import('node:child_process'); return cp.spawnSync('id').stdout});` },
  { id: 'PR-02', cat: 'process', name: 'child_process via createRequire / require', code: P + `import {createRequire} from 'node:module';
await T(()=>createRequire(import.meta.url)('child_process').execSync('id').toString());` },
  { id: 'PR-03', cat: 'process', name: 'child_process via process.getBuiltinModule / process.binding(spawn_sync)', code: P + `await T(()=>process.getBuiltinModule('node:child_process').execSync('id').toString());
await T(()=>process.binding('spawn_sync'));
await T(()=>process.binding('process_wrap'));` },
  { id: 'PR-04', cat: 'process', name: 'bounded fork bomb (6 x spawn of self)', code: P + `await T(async()=>{const {spawn}=await import('node:child_process'); let n=0; for(let i=0;i<6;i++){spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:'ignore',detached:true}); n++;} return 'spawned '+n});` },
  { id: 'PR-05', cat: 'process', name: 'worker_threads Worker (file + eval)', code: P + `await T(async()=>{const {Worker}=await import('node:worker_threads'); new Worker('while(true){}',{eval:true}); return 'worker'});` },
  { id: 'PR-06', cat: 'process', name: 'process.kill(ppid, SIGUSR2) (signal the runner parent)', code: P + `await T(()=>process.kill(process.ppid,'SIGUSR2'));
await T(()=>process._kill(process.ppid,12));` },
  { id: 'PR-07', cat: 'process', name: 'process.execve / dlopen / _debugProcess(ppid) / setuid', code: P + `await T(()=>process.execve('/bin/sh',['sh','-c','echo ESCAPED:execve'],{}));
await T(()=>process.dlopen({exports:{}},'/lib/x86_64-linux-gnu/libc.so.6'));
await T(()=>process._debugProcess(process.ppid));
await T(()=>process.setuid(1000));` },
  { id: 'PR-08', cat: 'process', name: 'ignore SIGTERM + busy loop (must die by SIGKILL)', resource: true, expect: ['timeout'], opts: { timeoutMs: 800 }, code: `process.on('SIGTERM',()=>{}); process.on('SIGINT',()=>{}); while(true){}` },

  // ---------------- network ----------------
  { id: 'NET-01', cat: 'net', name: 'net.connect to local TCP listener (dynamic import)', code: P + `await T(async()=>{const net=await import('node:net'); return await new Promise((res,rej)=>{const s=net.connect(${c.tcpPort},'127.0.0.1',()=>res('connected')); s.on('error',rej); setTimeout(()=>rej(new Error('t')),500)})});` },
  { id: 'NET-02', cat: 'net', name: 'net.Socket via process.stdout.constructor / stdout.connect', code: P + `await T(()=>{const S=process.stdout.constructor; const s=new S({}); s.connect(${c.tcpPort},'127.0.0.1'); return 'connect issued'});
await T(()=>{process.stdout.connect(${c.tcpPort},'127.0.0.1'); return 'stdout.connect'});
await new Promise(r=>setTimeout(r,200));` },
  { id: 'NET-03', cat: 'net', name: 'http.get to local HTTP server', code: P + `await T(async()=>{const http=await import('node:http'); return await new Promise((res,rej)=>{http.get('http://127.0.0.1:${c.httpPort}/',r=>res('status '+r.statusCode)).on('error',rej)})});` },
  { id: 'NET-04', cat: 'net', name: 'global fetch() to local HTTP server', code: P + `await T(async()=>{const r=await fetch('http://127.0.0.1:${c.httpPort}/'); return 'status '+r.status});` },
  { id: 'NET-05', cat: 'net', name: 'WebSocket / EventSource globals', code: P + `await T(()=>{const w=new WebSocket('ws://127.0.0.1:${c.tcpPort}/'); return 'ws '+w.readyState});
await T(()=>{const e=new EventSource('http://127.0.0.1:${c.httpPort}/'); return 'es '+e.readyState});
await new Promise(r=>setTimeout(r,200));` },
  { id: 'NET-06', cat: 'net', name: 'dgram UDP send to local listener', code: P + `await T(async()=>{const dgram=await import('node:dgram'); const s=dgram.createSocket('udp4'); return await new Promise((res,rej)=>{s.send('hi',${c.udpPort},'127.0.0.1',e=>e?rej(e):res('sent'))})});` },
  { id: 'NET-07', cat: 'net', name: 'dns.lookup / dns.promises.resolve4 (localhost)', code: P + `await T(async()=>{const dns=await import('node:dns'); return await new Promise((res,rej)=>dns.lookup('localhost',(e,a)=>e?rej(e):res(a)))});
await T(async()=>{const d=await import('node:dns/promises'); return (await d.lookup('localhost')).address});` },
  { id: 'NET-08', cat: 'net', name: 'tls.connect / https.get / http2.connect to local port', code: P + `await T(async()=>{const tls=await import('node:tls'); tls.connect(${c.tcpPort},'127.0.0.1').on('error',()=>{}); return 'tls issued'});
await T(async()=>{const h=await import('node:https'); h.get('https://127.0.0.1:${c.tcpPort}/').on('error',()=>{}); return 'https issued'});
await T(async()=>{const h2=await import('node:http2'); h2.connect('http://127.0.0.1:${c.httpPort}').on('error',()=>{}); return 'h2 issued'});
await new Promise(r=>setTimeout(r,300));` },
  { id: 'NET-09', cat: 'net', name: 'inspector.open() (debug port = full control) / Session', code: P + `await T(async()=>{const i=await import('node:inspector'); i.open(0,'127.0.0.1',false); const u=i.url(); i.close(); return u});` },
  { id: 'NET-10', cat: 'net', name: 'net.createServer().listen (open a listening port)', code: P + `await T(async()=>{const net=await import('node:net'); return await new Promise((res,rej)=>{const s=net.createServer().on('error',rej); s.listen(0,'127.0.0.1',()=>{const p=s.address().port; s.close(); res('listening '+p)})})});` },

  // ---------------- module / code-gen / tamper ----------------
  { id: 'MOD-01', cat: 'module', name: 'eval / new Function / AsyncFunction / Function.prototype.constructor', code: P + `await T(()=>eval('1+1'));
await T(()=>new Function('return 1')());
await T(()=>(async()=>{}).constructor('return process.env')());
await T(()=>(function(){}).constructor('return 1')());
await T(()=>globalThis.constructor.constructor('return 1')());` },
  { id: 'MOD-02', cat: 'module', name: 'vm.runInNewContext / vm.Script escape (this.constructor.constructor)', code: P + `await T(async()=>{const vm=await import('node:vm'); return vm.runInNewContext('this.constructor.constructor("return typeof process")()')});
await T(async()=>{const vm=await import('node:vm'); return vm.runInThisContext('typeof process')});` },
  { id: 'MOD-03', cat: 'module', name: 'blocked-module spelling variants (NET, node:NET, net/, node:net?x, dns/promises)', code: P + `for (const s of ['net','node:net','NET','node:NET','net/','node:net?x','node:net#x','dns/promises','node:http','node:cluster','node:repl']) { await T(async()=>{const m=await import(s); return s+' -> '+Object.keys(m).length}); }` },
  { id: 'MOD-04', cat: 'module', name: 'CJS entry: require.main / module.constructor._load / process.mainModule', lang: 'cjs', code: P.replace(/console\.log/g, 'console.log') + `T(()=>require('net') && 'require net');
T(()=>module.constructor._load('child_process') && '_load cp');
T(()=>process.mainModule.require('http') && 'mainModule http');
T(()=>require('module')._load('dgram') && 'Module._load dgram');
T(()=>require.main.require('dns') && 'require.main dns');` },
  { id: 'MOD-05', cat: 'module', name: 'nested/data: URL import of blocked module', code: P + `await T(async()=>{await import('data:text/javascript,import net from "node:net"; globalThis.X=net.connect; '); return 'imported net via data:'});
await T(async()=>{await import('data:text/javascript,import * as cp from "node:child_process"; globalThis.CP=cp;'); return 'imported cp via data:'});` },
  { id: 'MOD-06', cat: 'module', name: 'load module/v8/os/wasi/tty (hook tamper, flags, info leak)', code: P + `for (const s of ['node:module','node:v8','node:os','node:wasi','node:tty','node:trace_events','node:sqlite']) { await T(async()=>{const m=await import(s); return s+' -> '+Object.keys(m).length}); }` },
  { id: 'MOD-07', cat: 'module', name: 'tamper with guard (overwrite/delete getBuiltinModule, fetch, process.binding, Socket.connect) then use net', code: P + `let n=0; const attempt=(f)=>{try{f(); n++}catch{}};
attempt(()=>{process.getBuiltinModule=()=>({})}); attempt(()=>{delete process.getBuiltinModule});
attempt(()=>{globalThis.fetch=()=>1}); attempt(()=>{delete globalThis.fetch}); attempt(()=>{process.binding=()=>1}); attempt(()=>{process.kill=()=>1});
attempt(()=>{Object.getPrototypeOf(process.stdout).connect=()=>1});
await T(()=>{ if (process.getBuiltinModule!==Object.getOwnPropertyDescriptor(process,'getBuiltinModule').value) return 'replaced'; return process.getBuiltinModule('node:net') && 'net via gbm after tamper'});
await T(async()=>{const S=process.stdout.constructor; const s=new S({}); s.connect(${c.tcpPort},'127.0.0.1'); await new Promise(r=>setTimeout(r,150)); return 'connect after tamper'});` },

  // ---------------- env ----------------
  { id: 'ENV-01', cat: 'env', name: 'read secrets from env (process.env, report.getReport)', controlOpts: { env: { [c.secretName]: c.secretValue } }, code: P + `await T(()=>{const k=Object.keys(process.env); if(k.length) return 'env keys: '+k.join(','); throw Object.assign(new Error('empty'),{code:'EMPTY_ENV'})});
await T(()=>{const e=process.report.getReport().environmentVariables||{}; const k=Object.keys(e); if(k.length) return 'report env: '+k.join(','); throw Object.assign(new Error('empty'),{code:'EMPTY_ENV'})});
await T(()=>process.env.HOME || process.env.PATH || (()=>{throw Object.assign(new Error('unset'),{code:'UNSET'})})());` },

  // ---------------- resources (expect the runner to contain them) ----------------
  { id: 'RES-01', cat: 'resource', name: 'infinite synchronous loop', resource: true, expect: ['timeout'], opts: { timeoutMs: 800 }, code: `while(true){}` },
  { id: 'RES-02', cat: 'resource', name: 'never-ending timers + microtask storm', resource: true, expect: ['timeout'], opts: { timeoutMs: 800 }, code: `setInterval(()=>{},1000); (function s(){Promise.resolve().then(s)})();` },
  { id: 'RES-03', cat: 'resource', name: 'Atomics.wait forever (0% CPU, defeats RLIMIT_CPU)', resource: true, expect: ['timeout'], opts: { timeoutMs: 800 }, code: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);` },
  { id: 'RES-04', cat: 'resource', name: 'Buffer.alloc(2GB) untouched (calloc, virtual only)', resource: true, expect: ['error', 'ok', 'memory_limit'], code: `try{const b=Buffer.alloc(2e9); console.log('alloc ok', b.length)}catch(e){console.log('ALLOC-FAIL', e.code||e.message)}` },
  { id: 'RES-05', cat: 'resource', name: 'Buffer.alloc(2GB, 1) touched (RSS)', resource: true, expect: ['error', 'memory_limit'], code: `const b=Buffer.alloc(2e9,1); console.log('alloc+touch ok', b.length)` },
  { id: 'RES-06', cat: 'resource', name: 'Buffer.alloc(2GB,1) touched, OS backstop disabled (watchdog alone)', resource: true, expect: ['memory_limit'], opts: { asMB: 0 }, code: `const b=Buffer.alloc(2e9,1); console.log('alloc+touch ok', b.length)` },
  { id: 'RES-07', cat: 'resource', name: 'incremental 16MB Buffer hoarding until OOM (watchdog alone)', resource: true, expect: ['memory_limit'], opts: { asMB: 0, timeoutMs: 8000 }, code: `const a=[]; for(;;){ a.push(Buffer.alloc(16<<20,1)); }` },
  { id: 'RES-08', cat: 'resource', name: 'JS heap bomb (arrays) until V8 OOM', resource: true, expect: ['error', 'memory_limit', 'killed_SIGABRT', 'killed_SIGTRAP'], opts: { timeoutMs: 8000 }, code: `const a=[]; for(;;){ a.push(new Array(1e6).fill(1)); }` },
  { id: 'RES-09', cat: 'resource', name: 'deep recursion (stack overflow)', resource: true, expect: ['ok', 'error'], code: `function f(n){return f(n+1)+1} try{f(0)}catch(e){console.log('caught', e.name)} function g(){return g()} g();` },
  { id: 'RES-10', cat: 'resource', name: 'stdout flood (endless console.log)', resource: true, expect: ['output_limit', 'memory_limit'], opts: { timeoutMs: 5000 }, code: `for(;;) console.log('x'.repeat(1000));` },
  { id: 'RES-11', cat: 'resource', name: 'stderr flood', resource: true, expect: ['output_limit'], opts: { timeoutMs: 5000 }, code: `for(;;) console.error('e'.repeat(1000));` },
  { id: 'RES-12', cat: 'resource', name: 'single 200MB stdout write', resource: true, expect: ['output_limit', 'memory_limit', 'error'], opts: { timeoutMs: 5000 }, code: `process.stdout.write('x'.repeat(200*1024*1024));` },
  { id: 'RES-13', cat: 'resource', name: 'zlib decompression bomb (40 x 64MB gunzip, kept)', resource: true, expect: ['memory_limit', 'error', 'output_limit'], opts: { timeoutMs: 6000 }, code: `import zlib from 'node:zlib'; const z=zlib.gzipSync(Buffer.alloc(64<<20)); const keep=[]; for(let i=0;i<40;i++){ keep.push(zlib.gunzipSync(z)); } console.log('bomb total', keep.length)` },
  { id: 'RES-14', cat: 'resource', name: 'process.exit(0) after forging a PASS line (result forgery, accepted risk)', accepted: true, code: `console.log(JSON.stringify({pass:true,tests:10,failed:0})); process.exit(0);` },
];

export const sqlAttacks = (c) => [
  { id: 'SQL-01', name: 'ATTACH DATABASE to absolute path', sql: `ATTACH DATABASE '${c.outside}/sql-attach.db' AS x; CREATE TABLE x.t(a);`, fileCheck: 'sql-attach.db' },
  { id: 'SQL-02', name: 'ATTACH obfuscation (case, comments, newline)', sql: `aTtAcH/**/DATABASE '${c.outside}/sql-attach2.db' AS x`, fileCheck: 'sql-attach2.db' },
  { id: 'SQL-03', name: 'ATTACH smuggled as 2nd statement', sql: `SELECT 1; ATTACH '${c.outside}/sql-attach3.db' AS x`, fileCheck: 'sql-attach3.db' },
  { id: 'SQL-04', name: 'NUL byte smuggle', sql: `SELECT 1;\u0000ATTACH '${c.outside}/sql-attach4.db' AS x`, fileCheck: 'sql-attach4.db' },
  { id: 'SQL-05', name: 'DETACH', sql: `DETACH DATABASE main` },
  { id: 'SQL-06', name: 'PRAGMA writable_schema / journal_mode / page_size (unsafe)', sql: `PRAGMA writable_schema=1; PRAGMA journal_mode=WAL` },
  { id: 'SQL-07', name: 'VACUUM INTO file', sql: `VACUUM INTO '${c.outside}/sql-vacuum.db'`, fileCheck: 'sql-vacuum.db' },
  { id: 'SQL-08', name: 'load_extension()', sql: `SELECT load_extension('/lib/x86_64-linux-gnu/libc.so.6')` },
  { id: 'SQL-09', name: 'quoted load_extension / fts3_tokenizer / readfile', sql: `SELECT "load_extension"('x'); SELECT fts3_tokenizer('a'); SELECT readfile('/etc/passwd')` },
  { id: 'SQL-10', name: 'file-path literal / CREATE VIRTUAL TABLE', sql: `CREATE VIRTUAL TABLE t USING csv(filename='/etc/passwd')` },
  { id: 'SQL-11', name: '> 20 statements (statement budget)', sql: Array.from({ length: 25 }, (_, i) => `SELECT ${i}`).join(';') },
  { id: 'SQL-12', name: 'unbounded recursive CTE aggregate (time budget 2s)', sql: `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c`, opts: { timeoutMs: 2000 }, expect: ['timeout'] },
  { id: 'SQL-13', name: 'unbounded recursive CTE SELECT rows (row cap)', sql: `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c`, opts: { timeoutMs: 2000 }, expect: ['ok'], expectTruncated: true },
  { id: 'SQL-14', name: 'hex(zeroblob(400MB)) memory bomb', sql: `SELECT length(hex(zeroblob(400000000)))`, opts: { timeoutMs: 3000 }, expect: ['ok', 'memory_limit', 'error'] },
  { id: 'SQL-15', name: 'string-doubling memory bomb', sql: `WITH RECURSIVE r(s) AS (SELECT 'x' UNION ALL SELECT s||s FROM r WHERE length(s)<900000000) SELECT length(s) FROM r ORDER BY 1 DESC LIMIT 1`, opts: { timeoutMs: 4000 }, expect: ['ok', 'memory_limit', 'error', 'timeout'] },
  { id: 'SQL-16', name: 'table-growth bomb (INSERT ... recursive) hits max_page_count', sql: `CREATE TABLE b(a BLOB); WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<200000) INSERT INTO b SELECT zeroblob(4096) FROM c`, opts: { timeoutMs: 4000 }, expect: ['ok', 'error', 'memory_limit'] },
];
