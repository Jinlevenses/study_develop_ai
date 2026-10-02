import { readFile } from 'node:fs/promises';
import { homePath } from '@fathom/shared-kernel/config/config';

// ADR-009 §6 — `run/cli.token`은 supervisor가 boot마다 쓴다. gateway는 읽기만 한다(없거나 형식 오류 = null, 캐시 안 함).

export type CliTokenReader = { get(): Promise<string | null> };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function createCliTokenReader(home: string): CliTokenReader {
  const file = homePath(home, 'run', 'cli.token');
  let cached: string | null = null;
  return {
    async get(): Promise<string | null> {
      if (cached !== null) {
        return cached;
      }
      let text: string;
      try {
        text = (await readFile(file, 'utf8')).trim();
      } catch {
        return null; // 아직 없음 — 다음 요청에 다시 읽는다
      }
      if (!TOKEN_RE.test(text)) {
        return null;
      }
      cached = text;
      return text;
    },
  };
}
