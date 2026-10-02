import { mkdir, readFile } from 'node:fs/promises';
import { homePath, writeFileAtomic } from '@fathom/shared-kernel/config/config';
import type { Logger } from '@fathom/shared-kernel/log/log';

// ADR-009 §1-6 — `run/session.key` = 원시 32바이트(0600). 재기동 후에도 유지되어 기존 쿠키가 살아남는다.

const KEY_BYTES = 32;

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';
}

export async function loadOrCreateSessionKey(
  home: string,
  deps: { readonly randomBytes: (n: number) => Uint8Array; readonly log: Logger },
): Promise<Uint8Array> {
  const dir = homePath(home, 'run');
  const file = homePath(home, 'run', 'session.key');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let existing: Uint8Array | null = null;
  try {
    existing = await readFile(file);
  } catch (e) {
    if (!isNotFound(e)) {
      throw e;
    }
  }
  if (existing !== null) {
    if (existing.length === KEY_BYTES) {
      return new Uint8Array(existing);
    }
    // 형식 오류 — 길이만 기록하고 재생성한다(기존 세션은 무효화된다).
    deps.log.warn({ event: 'gateway.session_key.invalid', length: existing.length }, 'session key invalid; regenerating');
  }
  const fresh = deps.randomBytes(KEY_BYTES);
  await writeFileAtomic(file, fresh, { mode: 0o600 });
  return fresh;
}
