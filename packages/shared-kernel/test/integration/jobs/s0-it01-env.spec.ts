import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createJobRunner } from '../../../src/jobs/jobs.js';

const ENTRY = fileURLToPath(new URL('./fixtures/job-entry.ts', import.meta.url));
const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];

describe('JobRunner 자식 env (실제 자식 프로세스)', () => {
  it('UT-SK-223 부모에 *_API_KEY를 심어도 실제 자식 프로세스 env에는 없고 PATH·FATHOM_HOME은 있다 [STD-CFG-21][NFR-SEC-005]', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-leak-me');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-leak-me');
    vi.stubEnv('GEMINI_API_KEY', 'gem-leak-me');
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-leak-me');
    vi.stubEnv('FATHOM_HOME', '/tmp/fathom-job-env');
    try {
      const r = await createJobRunner({ entry: ENTRY, execArgv: EXEC_ARGV }).run(
        'integrity',
        { mode: 'env' },
        { timeoutMs: 30_000 },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const keys = r.value.env as string[];
        expect(keys.filter((k) => /_API_KEY$/.test(k))).toEqual([]);
        expect(keys).toContain('PATH');
        expect(keys).toContain('FATHOM_HOME');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);
});
