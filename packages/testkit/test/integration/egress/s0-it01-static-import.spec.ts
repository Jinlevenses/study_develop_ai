import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// T-01-01 §4.1-⑦ (CR-72) — 이 preload는 boundaries.json 허용 경로(`packages/testkit/src/preload/**`)라서 child_process를 정적 import한다.

const FILE = path.resolve(import.meta.dirname, '../../../src/preload/egress-recorder.mjs');

describe('egress-recorder 정적 import', () => {
  it('UT-TK-074 egress-recorder는 정적 `node:child_process` import이고 process.getBuiltinModule·biome-ignore가 0이다 [NFR-AVL-001]', async () => {
    const text = await readFile(FILE, 'utf8');
    expect(text).toMatch(/^import childProcess from 'node:child_process';$/m);
    expect(text).not.toContain('getBuiltinModule');
    expect(text).not.toContain('biome-ignore');
  });
});
