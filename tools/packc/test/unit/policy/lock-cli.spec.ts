// UT-PACKC-051~058 — pnpm policy:lock (tools/packc/src/policy/lock-cli.ts, PGM-PACKC-010, ARC-01 §10.4, DCP-01 §6.16).
// 저장소 policy/는 읽기만 한다 — 쓰기·변형은 테스트마다 만든 임시 복사본에서만.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '@fathom/shared-kernel/policy/policy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLock, diffLock, LOCK_FILE, main, POLICY_SCHEMAS, serializeLock } from '../../../src/policy/lock-cli.js';

const REPO_POLICY = fileURLToPath(new URL('../../../../../policy/', import.meta.url));

type Run = { readonly code: number; readonly stdout: readonly string[]; readonly stderr: readonly string[] };

function lines(chunks: readonly string[]): string[] {
  return chunks
    .join('')
    .split('\n')
    .filter((l) => l !== '');
}

/** main()을 돌리고 stdout·stderr 줄을 모은다(실제 터미널 출력 0). */
function run(argv: readonly string[]): Run {
  const out: string[] = [];
  const errOut: string[] = [];
  const o = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    out.push(String(chunk));
    return true;
  });
  const e = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    errOut.push(String(chunk));
    return true;
  });
  try {
    const code = main(argv);
    return { code, stdout: lines(out), stderr: lines(errOut) };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fathom-policy-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function copyRepoPolicy(): string {
  const dir = join(tmp, 'policy');
  cpSync(REPO_POLICY, dir, { recursive: true });
  return dir;
}

function editFile(file: string, from: string | RegExp, to: string): void {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(from, to);
  expect(after).not.toBe(before);
  writeFileSync(file, after, 'utf8');
}

describe('policy:lock — 저장소 정합', () => {
  it('UT-PACKC-051 저장소 policy/에서 --check = 0이고 재계산 직렬화가 커밋된 policy.lock.json 바이트와 같다 [NFR-MAINT-007]', () => {
    const r = run(['--check']);
    expect(r.code).toBe(0);
    expect(r.stdout).toEqual(['policy:lock files=12 ok']);
    const lock = computeLock(REPO_POLICY);
    expect(lock.ok).toBe(true);
    if (lock.ok) {
      expect(serializeLock(lock.value)).toBe(readFileSync(join(REPO_POLICY, LOCK_FILE), 'utf8'));
    }
  });
});

describe('policy:lock — 차이 검출', () => {
  it('UT-PACKC-052 값 1개를 바꾼 cbm_params@v1(버전 그대로)는 --check 1·stale이고 loadPolicy는 hash_mismatch·78로 거부한다 [FR-CUR-017]', () => {
    const dir = copyRepoPolicy();
    editFile(join(dir, 'cbm_params@v1.yaml'), 'wrong: [0, -2, -6]', 'wrong: [0, -2, -5]');
    const r = run(['--dir', dir, '--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toEqual(['stale cbm_params@v1']);
    const loaded = loadPolicy('cbm_params', 1, { policyDir: dir, schema: POLICY_SCHEMAS.cbm_params });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.reason).toBe('hash_mismatch');
      expect(loaded.error.exitCode).toBe(78);
    }
  });

  it('UT-PACKC-053 정책 파일·lock 항목·lock 파일 누락을 extra·missing으로 보고하고 쓰기 모드 후 --check = 0이다 [NFR-MAINT-007]', () => {
    const dir = copyRepoPolicy();
    const opsFile = join(dir, 'ops_policy@v1.yaml');
    const opsText = readFileSync(opsFile, 'utf8');
    const lockPath = join(dir, LOCK_FILE);
    const lockText = readFileSync(lockPath, 'utf8');

    // ① 파일 삭제, lock 유지 → lock에만 있는 항목 = extra
    unlinkSync(opsFile);
    let r = run(['--dir', dir, '--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toEqual(['extra ops_policy@v1']);

    // ② 파일 복원, lock에서 그 항목만 삭제 → missing
    writeFileSync(opsFile, opsText, 'utf8');
    const lockJson: unknown = JSON.parse(lockText);
    expect(typeof lockJson === 'object' && lockJson !== null).toBe(true);
    if (typeof lockJson === 'object' && lockJson !== null) {
      Reflect.deleteProperty(lockJson, 'ops_policy@v1');
      writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`, 'utf8');
    }
    r = run(['--dir', dir, '--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toEqual(['missing ops_policy@v1']);

    // ③ lock 파일 삭제
    unlinkSync(lockPath);
    r = run(['--dir', dir, '--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toEqual(['missing policy.lock.json']);

    // ④ 쓰기 모드 → 같은 바이트 재생성, 직후 --check = 0, 임시 파일 0
    r = run(['--dir', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toEqual(['policy:lock files=12 written']);
    expect(readFileSync(lockPath, 'utf8')).toBe(lockText);
    expect(existsSync(`${lockPath}.tmp`)).toBe(false);
    expect(run(['--dir', dir, '--check']).code).toBe(0);
  });
});

describe('policy:lock — 정책 문제', () => {
  it('UT-PACKC-054 잘못된 파일 이름은 bad_filename·12종 밖 이름은 unknown_policy로 exit 1(lock 미변경)이고 비 YAML 파일은 무시한다 [FR-CUR-017]', () => {
    const dir = copyRepoPolicy();
    const lockPath = join(dir, LOCK_FILE);
    const lockBefore = readFileSync(lockPath, 'utf8');

    writeFileSync(join(dir, 'README.md'), '# 정책 팩\n', 'utf8');
    expect(run(['--dir', dir, '--check']).code).toBe(0);

    writeFileSync(join(dir, 'Mastery@v1.yaml'), 'version: Mastery@v1\n', 'utf8');
    writeFileSync(join(dir, 'foo_bar@v1.yaml'), 'version: foo_bar@v1\n', 'utf8');
    for (const argv of [
      ['--dir', dir],
      ['--dir', dir, '--check'],
    ]) {
      const r = run(argv);
      expect(r.code).toBe(1);
      expect(r.stdout).toHaveLength(2);
      expect(r.stdout[0]).toMatch(/^error Mastery@v1\.yaml bad_filename /);
      expect(r.stdout[1]).toMatch(/^error foo_bar@v1\.yaml unknown_policy /);
    }
    expect(readFileSync(lockPath, 'utf8')).toBe(lockBefore);
    expect(existsSync(`${lockPath}.tmp`)).toBe(false);
  });

  it('UT-PACKC-055 선언 version이 파일 이름과 다르면 version_mismatch, 별칭·앵커·중복 키 YAML은 yaml_error다 [FR-CUR-017][STD-SEC-08]', () => {
    const dir = join(tmp, 'p');
    mkdirSync(dir);
    copyFileSync(join(REPO_POLICY, 'mastery_rules@v1.yaml'), join(dir, 'mastery_rules@v1.yaml'));
    editFile(join(dir, 'mastery_rules@v1.yaml'), /^version: mastery_rules@v1$/m, 'version: mastery_rules@v2');
    writeFileSync(
      join(dir, 'cbm_params@v1.yaml'),
      'version: cbm_params@v1\nscore: &s { correct: [1, 2, 3], wrong: [0, -2, -6] }\nalso: *s\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'ops_policy@v1.yaml'),
      'version: ops_policy@v1\ndisk_warn_mb: 500\ndisk_warn_mb: 600\n',
      'utf8',
    );

    const lock = computeLock(dir);
    expect(lock.ok).toBe(false);
    if (!lock.ok) {
      expect(lock.error.map((p) => [p.file, p.reason])).toEqual([
        ['cbm_params@v1.yaml', 'yaml_error'],
        ['mastery_rules@v1.yaml', 'version_mismatch'],
        ['ops_policy@v1.yaml', 'yaml_error'],
      ]);
      expect(lock.error[1]?.detail).toContain('mastery_rules@v2');
    }
    const r = run(['--dir', dir]);
    expect(r.code).toBe(1);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it('UT-PACKC-056 cbm 점수표 단조성 위반·형식 위반과 per_task 6키 ai_policy는 schema_invalid다 [NFR-MAINT-007][CR-43]', () => {
    const dir = copyRepoPolicy();
    const cbm = join(dir, 'cbm_params@v1.yaml');
    const cbmText = readFileSync(cbm, 'utf8');

    // [1, 1, 3] — 엄격 증가 위반(score 객체 refine → 경로 score, 메시지에 correct)
    editFile(cbm, 'correct: [1, 2, 3]', 'correct: [1, 1, 3]');
    let lock = computeLock(dir);
    expect(lock.ok).toBe(false);
    if (!lock.ok) {
      expect(lock.error).toHaveLength(1);
      expect(lock.error[0]?.reason).toBe('schema_invalid');
      expect(lock.error[0]?.detail).toMatch(/^score .*correct/);
    }
    // 원소 형식 위반 → 경로 score.correct.1
    writeFileSync(cbm, cbmText.replace('correct: [1, 2, 3]', "correct: [1, 'two', 3]"), 'utf8');
    lock = computeLock(dir);
    expect(lock.ok).toBe(false);
    if (!lock.ok) {
      expect(lock.error[0]?.reason).toBe('schema_invalid');
      expect(lock.error[0]?.detail).toContain('score.correct');
    }
    writeFileSync(cbm, cbmText, 'utf8');

    // ai_policy per_task를 AI-01 §12.5 원문 6키로 되돌리면 전수 record(35키) 위반
    editFile(
      join(dir, 'ai_policy@v1.yaml'),
      /^ {2}per_task:.*\n(?: {4}\S.*\n)+/m,
      '  per_task: { AI-G07: 0, AI-G09: 0, AI-G06: 1, SYS-CANARY: 0, SYS-SMOKE: 0, SYS-FWCLS: 0 }\n',
    );
    const r = run(['--dir', dir, '--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toHaveLength(1);
    expect(r.stdout[0]).toMatch(/^error ai_policy@v1\.yaml schema_invalid cache_ttl_days\.per_task/);
  });

  it('UT-PACKC-057 빈 디렉터리·없는 디렉터리·알 수 없는 인자는 엔진 고장 2다 [NFR-MAINT-005]', () => {
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'README.md'), '# 비어 있음\n', 'utf8');
    let r = run(['--dir', empty, '--check']);
    expect(r.code).toBe(2);
    expect(r.stderr).toHaveLength(1);
    expect(r.stdout).toEqual([]);

    r = run(['--dir', join(tmp, 'nope')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toHaveLength(1);

    r = run(['--frobnicate']);
    expect(r.code).toBe(2);
    expect(r.stderr[0]).toContain('unknown argument --frobnicate');

    r = run(['--dir']);
    expect(r.code).toBe(2);
  });
});

describe('policy:lock — 결정성', () => {
  it('UT-PACKC-058 computeLock·직렬화는 결정적이고 sha256은 키 순서·주석·공백에 불변인 정규 JSON 해시다 [NFR-MAINT-007]', () => {
    const a = computeLock(REPO_POLICY);
    const b = computeLock(REPO_POLICY);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const text = serializeLock(a.value);
      expect(text.endsWith('}\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      const parsed: unknown = JSON.parse(text);
      expect(typeof parsed === 'object' && parsed !== null).toBe(true);
      if (typeof parsed === 'object' && parsed !== null) {
        const refs = Object.keys(parsed);
        expect(refs).toEqual([...refs].sort());
        expect(refs).toHaveLength(12);
      }
      expect(text.split('\n')[1]).toMatch(/^ {2}"ai_policy@v1": \{$/);
      expect(text.split('\n')[2]).toMatch(/^ {4}"owner": "ai-gateway",$/);
      expect(text.split('\n')[3]).toMatch(/^ {4}"sha256": "[0-9a-f]{64}"$/);
      expect(diffLock(text, text)).toEqual([]);
    }

    const d1 = join(tmp, 'd1');
    const d2 = join(tmp, 'd2');
    mkdirSync(d1);
    mkdirSync(d2);
    writeFileSync(
      join(d1, 'cbm_params@v1.yaml'),
      'version: cbm_params@v1\nscore:\n  correct: [1, 2, 3]\n  wrong: [0, -2, -6]\n',
    );
    writeFileSync(
      join(d2, 'cbm_params@v1.yaml'),
      '# 다른 주석\nscore: { wrong: [ 0, -2,   -6 ],  correct: [1,2,3] }   # 키 순서 반대\nversion: "cbm_params@v1"\n',
    );
    const l1 = computeLock(d1);
    const l2 = computeLock(d2);
    expect(l1.ok && l2.ok).toBe(true);
    if (l1.ok && l2.ok) {
      const independent = createHash('sha256')
        .update('{"score":{"correct":[1,2,3],"wrong":[0,-2,-6]},"version":"cbm_params@v1"}', 'utf8')
        .digest('hex');
      expect(l1.value['cbm_params@v1']?.sha256).toBe(independent);
      expect(l2.value['cbm_params@v1']?.sha256).toBe(independent);
      expect(serializeLock(l1.value)).toBe(serializeLock(l2.value));
    }
  });
});
