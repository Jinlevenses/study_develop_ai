import { exec, execSync as run } from 'node:child_process'; // EXPECT[security/child-process-exec]
import * as ns from 'node:child_process';
import cp from 'node:child_process';
import * as nodeUrl from 'node:url';
import { parse } from 'node:url';

export function bad(x: string, e: HTMLElement, db: { backup(p: string): void }) {
  eval(x); // EXPECT[security/eval]
  globalThis.eval(x); // EXPECT[security/eval]
  const f = new Function('a', x); // EXPECT[security/new-function]
  ns.exec(x); // EXPECT[security/child-process-exec]
  cp.execSync(x); // EXPECT[security/child-process-exec]
  const o = { shell: true }; // EXPECT[security/shell-true]
  const env = process.env['NODE_TLS_REJECT_UNAUTHORIZED']; // EXPECT[security/tls-reject-env]
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // EXPECT[security/tls-reject-env]
  const agent = { rejectUnauthorized: false }; // EXPECT[security/reject-unauthorized]
  Buffer.allocUnsafe(8); // EXPECT[security/buffer-alloc-unsafe]
  Buffer.allocUnsafeSlow(8); // EXPECT[security/buffer-alloc-unsafe]
  e.innerHTML = x; // EXPECT[security/inner-html]
  e.outerHTML = x; // EXPECT[security/inner-html]
  e.insertAdjacentHTML('beforeend', x); // EXPECT[security/insert-adjacent-html]
  document.write(x); // EXPECT[security/document-write]
  new Buffer(8); // EXPECT[security/new-buffer]
  nodeUrl.parse(x); // EXPECT[security/url-parse]
  parse(x); // EXPECT[security/url-parse]
  url.parse(x); // EXPECT[security/url-parse]
  createCipher('aes', x); // EXPECT[security/create-cipher]
  createHash('MD5'); // EXPECT[security/weak-hash]
  createHash('sha1'); // EXPECT[security/weak-hash]
  db.backup('x'); // EXPECT[security/sqlite-backup]
  const k = 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx'; // EXPECT[security/secret-literal]
  const t = `-----BEGIN RSA PRIVATE KEY-----`; // EXPECT[security/secret-literal]
  return [f, o, env, agent, run, exec, k, t];
}
