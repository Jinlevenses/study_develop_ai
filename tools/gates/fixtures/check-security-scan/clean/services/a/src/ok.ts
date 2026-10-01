import { createCipheriv, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const RE = /(\d+)/;

export function ok(line: string, foo: { eval(x: string): void }) {
  RE.exec(line);
  /(\d+)/.exec(line);
  // eval(x) and new Function(x) only appear in this comment
  const s = 'eval(x) and shell: true only appear in a string';
  const h = createHash('sha256');
  createCipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12));
  spawn('ls', [], { shell: false });
  foo.eval(s);
  const o = { innerHTML: 'a key, not a property access' };
  return [h, o, Math.random()];
}
