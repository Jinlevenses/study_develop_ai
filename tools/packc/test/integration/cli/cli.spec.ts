// IT-660~669 — packc CLI를 자식 프로세스로 실행(node --import tsx, shell: false, cwd = repo). 임시 디렉터리에만 쓴다.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FpackManifest } from '@fathom/contracts/pack/manifest';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURES, listCases, materialize, mutatedTree, REPO_ROOT, rmTmp, tmpRoot } from '../../unit/cli/helpers.js';
import { readTar } from '../../unit/emit/tar-reader.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});
function tmp(): string {
  const r = tmpRoot();
  roots.push(r);
  return r;
}

const CLI = 'tools/packc/src/cli.ts';
const stderrs: string[] = [];

type Child = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

function child(args: readonly string[]): Child {
  const r = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source', CLI, ...args],
    {
      cwd: REPO_ROOT,
      shell: false,
      encoding: 'utf8',
      timeout: 50_000,
    },
  );
  stderrs.push(r.stderr);
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function nonEmpty(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

describe('IT-660 scaffold + check on the real R4 [FR-CUR-001][FR-CUR-009]', () => {
  it('IT-660 scaffolds 469 concepts and 20 pack.yaml, then check exits 0 [FR-CUR-001][FR-CUR-009]', () => {
    const root = tmp();
    const content = join(root, 'content');
    const s = child(['scaffold', '--content-dir', content, '--as-of', '2026-10-02']);
    expect(s.code).toBe(0);
    expect(nonEmpty(s.stdout)).toEqual(['scaffold rows=469 edges=518 created=469 skipped=0 packs_created=20']);
    cpSync(join(FIXTURES, 'base/content/templates'), join(content, 'templates'), { recursive: true });
    cpSync(join(FIXTURES, 'base/content/sources'), join(content, 'sources'), { recursive: true });
    let concepts = 0;
    let packs = 0;
    for (const t of readdirSync(join(content, 'packs'))) {
      concepts += readdirSync(join(content, 'packs', t, 'concepts')).length;
      packs += existsSync(join(content, 'packs', t, 'pack.yaml')) ? 1 : 0;
    }
    expect({ concepts, packs }).toEqual({ concepts: 469, packs: 20 });
    const c = child(['check', '--content-dir', content]);
    expect(
      c.code,
      c.stdout
        .split('\n')
        .filter((l) => l.startsWith('error'))
        .slice(0, 5)
        .join('\n'),
    ).toBe(0);
    expect(nonEmpty(c.stdout).at(-1)).toMatch(/^content:check packs=20 files=\d+ errors=0 warnings=\d+$/);
    expect(c.stderr).toBe('');
  });
});

describe('IT-661 negative fixture [FR-CUR-003]', () => {
  it('IT-661 a negative fixture exits 1 and prints the rule line [FR-CUR-003]', () => {
    const c = listCases().find((x) => x.rule === 'r-dag' && x.name === 'cycle');
    expect(c).toBeDefined();
    if (c === undefined) {
      return;
    }
    const root = tmp();
    const dir = materialize(root, { ...c.spec, overlay: c.dir });
    const r = child(['check', '--content-dir', dir]);
    expect(r.code).toBe(1);
    expect(
      nonEmpty(r.stdout).some((l) =>
        l.startsWith('error R-DAG packs/docker/concepts/docker.dockerfile.md#prereqs prerequisite cycle:'),
      ),
    ).toBe(true);
    expect(r.stderr).toBe('');
  });
});

describe('IT-662 engine failure [NFR-MAINT-005]', () => {
  it('IT-662 an empty content directory or a missing one exits 2 with one stderr line [NFR-MAINT-005]', () => {
    const root = tmp();
    for (const dir of [root, join(root, 'does-not-exist')]) {
      const r = child(['check', '--content-dir', dir]);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe('');
      expect(nonEmpty(r.stderr)).toHaveLength(1);
      expect(r.stderr.startsWith('packc: ')).toBe(true);
    }
  });
});

describe('IT-663~664 build [FR-CUR-002]', () => {
  it('IT-663 build writes one .fpack per pack that our ustar reader restores into four entries [FR-CUR-002]', () => {
    const t = mutatedTree();
    roots.push(t.root);
    const out = join(t.root, 'dist/packs');
    const r = child(['build', '--content-dir', t.contentDir, '--out-dir', out]);
    expect(r.code).toBe(0);
    expect(nonEmpty(r.stdout).at(-1)).toBe('packs:build packs=2 written=2 errors=0');
    expect(readdirSync(out).sort()).toEqual(['docker@0.1.0.fpack', 'k8s@0.1.0.fpack']);
    for (const name of readdirSync(out)) {
      const tar = readTar(readFileSync(join(out, name)));
      expect(tar.files.map((f) => f.name)).toEqual(['manifest.json', 'bundle.jsonl', 'report.json', 'layout.json']);
      expect(tar.files.every((f) => f.header.checksumOk)).toBe(true);
      const manifest = FpackManifest.parse(JSON.parse(tar.files[0]?.data.toString('utf8') ?? '{}'));
      expect(`${manifest.pack_id}@${manifest.version}.fpack`).toBe(name);
      for (const f of manifest.files) {
        const data = tar.files.find((x) => x.name === f.path)?.data ?? Buffer.alloc(0);
        expect(sha256Hex(data)).toBe(f.sha256);
        expect(data.length).toBe(f.bytes);
      }
    }
  });

  it('IT-664 building twice gives byte-identical .fpack files [FR-CUR-002]', () => {
    const t = mutatedTree();
    roots.push(t.root);
    const a = join(t.root, 'a');
    const b = join(t.root, 'b');
    expect(child(['build', '--content-dir', t.contentDir, '--out-dir', a]).code).toBe(0);
    expect(child(['build', '--content-dir', t.contentDir, '--out-dir', b]).code).toBe(0);
    for (const name of readdirSync(a)) {
      expect(readFileSync(join(a, name)).equals(readFileSync(join(b, name))), name).toBe(true);
    }
  });
});

describe('IT-665 schemas [FR-CUR-003]', () => {
  it('IT-665 schemas writes 12 files and --check passes afterwards [FR-CUR-003]', () => {
    const root = tmp();
    const content = join(root, 'content');
    const w = child(['schemas', '--content-dir', content]);
    expect(w.code).toBe(0);
    expect(readdirSync(join(content, '.schemas'))).toHaveLength(12);
    const c = child(['schemas', '--check', '--content-dir', content]);
    expect(c.code).toBe(0);
    expect(nonEmpty(c.stdout)).toEqual(['schemas ok']);
  });
});

describe('IT-666 --pack [FR-CUR-002]', () => {
  it('IT-666 --pack docker writes and reports only the docker pack [FR-CUR-002]', () => {
    const t = mutatedTree();
    roots.push(t.root);
    const out = join(t.root, 'dist/packs');
    const r = child(['build', '--content-dir', t.contentDir, '--out-dir', out, '--pack', 'docker', '--json']);
    expect(r.code).toBe(0);
    expect(readdirSync(out)).toEqual(['docker@0.1.0.fpack']);
    const json = JSON.parse(r.stdout);
    expect(json.summary).toMatchObject({ packs: 1, written: 1, errors: 0 });
    expect(json.findings.every((f: { file: string }) => !f.file.startsWith('packs/k8s/'))).toBe(true);
  });
});

describe('IT-667 hashes [FR-QST-011]', () => {
  it('IT-667 hashes --pack docker prints a key-sorted JSON object of 64-hex hashes [FR-QST-011]', () => {
    const t = mutatedTree();
    roots.push(t.root);
    const r = child(['hashes', '--pack', 'docker', '--content-dir', t.contentDir]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const parsed: Record<string, string> = JSON.parse(r.stdout);
    const keys = Object.keys(parsed);
    expect(keys.length).toBeGreaterThan(40);
    expect(keys).toEqual([...keys].sort());
    expect(Object.values(parsed).every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(r.stdout.endsWith('\n')).toBe(true);
  });
});

const hasContent = existsSync(join(REPO_ROOT, 'content/packs'));
describe('IT-668 repository content [FR-CUR-003]', () => {
  it.skipIf(!hasContent)('IT-668 the repository content/ passes check [FR-CUR-003]', () => {
    const r = child(['check']);
    expect(
      r.code,
      r.stdout
        .split('\n')
        .filter((l) => l.startsWith('error'))
        .slice(0, 5)
        .join('\n'),
    ).toBe(0);
  });
  it.skipIf(hasContent)('IT-668 skipped: the repository has no content/ yet (T-01-04 owns it) [FR-CUR-003]', () => {
    expect(hasContent).toBe(false);
  });
});

describe('IT-669 no Node warnings [NFR-MAINT-005]', () => {
  it('IT-669 no child run printed ExperimentalWarning or Warning on stderr [NFR-MAINT-005]', () => {
    const root = tmp();
    child(['schemas', '--content-dir', join(root, 'content')]);
    child(['check', '--content-dir', join(root, 'nope')]);
    expect(stderrs.length).toBeGreaterThan(8);
    for (const e of stderrs) {
      expect(e).not.toContain('ExperimentalWarning');
      expect(e).not.toContain('Warning');
    }
  });
});
