import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadPolicy, policyContentHash } from '../../../src/policy/policy.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/policy/', import.meta.url));
const ENTRY = fileURLToPath(new URL('./fixtures/load-entry.ts', import.meta.url));

const POLICY_NAMES = [
  'method_policy',
  'composer_policy',
  'mastery_rules',
  'ldi_params',
  'gaming_params',
  'cbm_params',
  'fsrs_params',
  'gate_thresholds',
  'search_params',
  'ai_policy',
  'firewall_rules',
  'ops_policy',
] as const;

/** 테스트 안의 독립 구현: 키 정렬 JSON(fixture는 평범한 JSON 값만 쓴다) → node:crypto sha256. */
function independentHash(value: unknown): string {
  const canon = (v: unknown): string => {
    if (Array.isArray(v)) {
      return `[${v.map(canon).join(',')}]`;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(v);
  };
  return createHash('sha256').update(canon(value)).digest('hex');
}

const testSchema = (name: string): z.ZodType =>
  name === 'mastery_rules' ? MasteryRulesV1 : z.object({ version: z.literal(`${name}@v1`) }).catchall(z.unknown());

let dir = '';

async function buildPolicyDir(): Promise<void> {
  const lock: Record<string, { sha256: string; owner: string }> = {};
  for (const name of POLICY_NAMES) {
    const file = `${name}@v1.yaml`;
    await copyFile(path.join(FIXTURES, file), path.join(dir, file));
    const parsed: unknown = parse(await readFile(path.join(dir, file), 'utf8'), { schema: 'core' });
    lock[`${name}@v1`] = { sha256: independentHash(parsed), owner: name === 'ai_policy' ? 'ai-gateway' : 'learning' };
  }
  await writeFile(path.join(dir, 'policy.lock.json'), JSON.stringify(lock, null, 2), 'utf8');
}

async function runEntry(
  policyDir: string,
  name: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning', ENTRY, policyDir, name, '1'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => {
    stdout += c.toString('utf8');
  });
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  const [code] = await once(child, 'close');
  return { code: typeof code === 'number' ? code : null, stdout, stderr };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'fathom-sk-policy-'));
  await buildPolicyDir();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadPolicy', () => {
  it('UT-SK-012 lock 일치 → 로드 성공, 같은 버전에서 YAML 값만 바꾸면 hash_mismatch(78)이고 진입점은 exit 78이다 [FR-CUR-017]', async () => {
    // Arrange / Act: 정상 로드
    const first = loadPolicy('fsrs_params', 1, { policyDir: dir, schema: testSchema('fsrs_params') });
    expect(first.ok).toBe(true);
    const ok = await runEntry(dir, 'fsrs_params');
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain('fsrs_params@v1');

    // 같은 버전, 값만 변경
    const file = path.join(dir, 'fsrs_params@v1.yaml');
    await writeFile(file, (await readFile(file, 'utf8')).replace('request_retention: 0.9', 'request_retention: 0.85'));
    const second = loadPolicy('fsrs_params', 1, { policyDir: dir, schema: testSchema('fsrs_params') });
    // Assert
    expect(second).toMatchObject({
      ok: false,
      error: { reason: 'hash_mismatch', exitCode: 78, ref: 'fsrs_params@v1' },
    });
    const bad = await runEntry(dir, 'fsrs_params');
    expect(bad.code).toBe(78);
    expect(bad.stderr).toContain('hash_mismatch');
    // 다른 정책은 영향이 없다.
    expect(loadPolicy('search_params', 1, { policyDir: dir, schema: testSchema('search_params') }).ok).toBe(true);
  });

  it('UT-SK-137 fixture 정책 12종을 lock으로 전부 로드하고 해시가 독립 계산과 같다 [FR-CUR-017][NFR-MAINT-007]', async () => {
    expect((await readdir(FIXTURES)).length).toBe(12);
    for (const name of POLICY_NAMES) {
      const r = loadPolicy(name, 1, { policyDir: dir, schema: testSchema(name) });
      expect(r.ok, name).toBe(true);
      if (!r.ok) {
        continue;
      }
      const raw: unknown = parse(await readFile(path.join(dir, `${name}@v1.yaml`), 'utf8'), { schema: 'core' });
      expect(r.value.ref).toBe(`${name}@v1`);
      expect(r.value.sha256).toBe(independentHash(raw));
      expect(policyContentHash(raw)).toBe(r.value.sha256);
      expect(r.value.owner).toBe(name === 'ai_policy' ? 'ai-gateway' : 'learning');
    }
    const mastery = loadPolicy('mastery_rules', 1, { policyDir: dir, schema: MasteryRulesV1 });
    expect(mastery.ok).toBe(true);
    if (mastery.ok) {
      expect(mastery.value.value.version).toBe('mastery_rules@v1');
      expect(mastery.value.value.epsilon).toBe(1e-9);
      expect(mastery.value.value.assessment.accuracy_min_correct['3']).toBe(10);
    }
  });

  it('UT-SK-138 lock_missing·lock_invalid·not_in_lock·file_missing·yaml_error(모두 78) [FR-CUR-017]', async () => {
    const schema = z.unknown();
    // not_in_lock
    expect(loadPolicy('unknown_policy', 1, { policyDir: dir, schema })).toMatchObject({
      ok: false,
      error: { reason: 'not_in_lock', exitCode: 78, ref: 'unknown_policy@v1' },
    });
    expect(loadPolicy('fsrs_params', 2, { policyDir: dir, schema })).toMatchObject({
      ok: false,
      error: { reason: 'not_in_lock' },
    });
    // file_missing
    await rm(path.join(dir, 'ops_policy@v1.yaml'));
    expect(loadPolicy('ops_policy', 1, { policyDir: dir, schema })).toMatchObject({
      ok: false,
      error: { reason: 'file_missing', exitCode: 78 },
    });
    // yaml_error (별칭)
    await writeFile(path.join(dir, 'ldi_params@v1.yaml'), 'a: &x 1\nb: *x\n');
    expect(loadPolicy('ldi_params', 1, { policyDir: dir, schema })).toMatchObject({
      ok: false,
      error: { reason: 'yaml_error' },
    });
    // lock_invalid: JSON 아님·스키마 위반·오염 키
    for (const body of [
      'not json',
      '[]',
      '{"fsrs_params@v1": {"sha256": "zz", "owner": "learning"}}',
      '{"__proto__": {}}',
    ]) {
      await writeFile(path.join(dir, 'policy.lock.json'), body);
      expect(loadPolicy('fsrs_params', 1, { policyDir: dir, schema }), body).toMatchObject({
        ok: false,
        error: { reason: 'lock_invalid', exitCode: 78 },
      });
    }
    // lock_missing
    await rm(path.join(dir, 'policy.lock.json'));
    expect(loadPolicy('fsrs_params', 1, { policyDir: dir, schema })).toMatchObject({
      ok: false,
      error: { reason: 'lock_missing', exitCode: 78 },
    });
    expect(loadPolicy('fsrs_params', 1, { policyDir: path.join(dir, 'nope'), schema })).toMatchObject({
      ok: false,
      error: { reason: 'lock_missing' },
    });
  });

  it('UT-SK-139 schema_invalid의 detail은 첫 이슈 경로이고 잘못된 name·version은 던진다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const strict = z.object({ version: z.string(), request_retention: z.string() }).strict();
    const r = loadPolicy('fsrs_params', 1, { policyDir: dir, schema: strict });
    expect(r).toMatchObject({ ok: false, error: { reason: 'schema_invalid', exitCode: 78, ref: 'fsrs_params@v1' } });
    if (!r.ok) {
      expect(r.error.detail).toBe('request_retention');
    }
    const root = loadPolicy('fsrs_params', 1, { policyDir: dir, schema: z.string() });
    expect(root).toMatchObject({ ok: false, error: { reason: 'schema_invalid', detail: '(root)' } });
    for (const badName of ['Bad', 'ab', 'a-b', '1abc', 'x'.repeat(42), '']) {
      expect(() => loadPolicy(badName, 1, { policyDir: dir, schema: z.unknown() }), badName).toThrow(/name must match/);
    }
    for (const badVersion of [0, 10_000, 1.5, -1, Number.NaN]) {
      expect(
        () => loadPolicy('fsrs_params', badVersion, { policyDir: dir, schema: z.unknown() }),
        String(badVersion),
      ).toThrow(/version/);
    }
  });
});
