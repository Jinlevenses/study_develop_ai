// 테스트 도우미 — fixture 트리 materialize · main() 실행(stdout/stderr 수집). 저장소 policy/·R4·fixtures는 읽기만, 쓰기는 임시 디렉터리에서만.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { z } from 'zod';
import { main } from '../../../src/cli.js';

export const PACKC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = join(PACKC_ROOT, 'fixtures');
export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const REPO_POLICY = join(REPO_ROOT, 'policy');
export const REPO_R4 = join(REPO_ROOT, 'docs/00-research/R4-curriculum-taxonomy.md');

export type Patch = { readonly file: string; readonly from: string; readonly to: string; readonly all?: boolean };
export type FixtureSpec = {
  readonly base: string;
  readonly delete: readonly string[];
  readonly replace: readonly Patch[];
  readonly args: readonly string[];
  readonly expect: { readonly exit: number; readonly rules: readonly string[] };
};
export type FixtureCase = {
  readonly rule: string;
  readonly name: string;
  readonly dir: string;
  readonly spec: FixtureSpec;
};

export function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'fathom-packc-'));
}

export function rmTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** base 트리를 `<root>/content`로 복사하고 삭제·치환·덮어쓰기를 적용한다. */
export function materialize(
  root: string,
  opts: { base?: string; delete?: readonly string[]; replace?: readonly Patch[]; overlay?: string } = {},
): string {
  cpSync(join(FIXTURES, opts.base ?? 'base', 'content'), join(root, 'content'), { recursive: true });
  for (const rel of opts.delete ?? []) {
    rmSync(join(root, rel), { recursive: true, force: true });
  }
  for (const p of opts.replace ?? []) {
    const path = join(root, p.file);
    const text = readFileSync(path, 'utf8');
    const n = text.split(p.from).length - 1;
    if (n === 0 || (n > 1 && p.all !== true)) {
      throw new Error(`fixture patch matched ${n} times in ${p.file}: ${p.from.slice(0, 60)}`);
    }
    writeFileSync(path, p.all === true ? text.split(p.from).join(p.to) : text.replace(p.from, () => p.to));
  }
  if (opts.overlay !== undefined) {
    const src = join(opts.overlay, 'content');
    try {
      statSync(src);
      cpSync(src, join(root, 'content'), { recursive: true });
    } catch {
      // overlay 없음
    }
  }
  return join(root, 'content');
}

const SpecSchema = z
  .object({
    base: z.string().default('base'),
    delete: z.array(z.string()).default([]),
    replace: z
      .array(z.object({ file: z.string(), from: z.string(), to: z.string(), all: z.boolean().optional() }).strict())
      .default([]),
    args: z.array(z.string()).default([]),
    expect: z.object({ exit: z.number().int(), rules: z.array(z.string()) }).strict(),
  })
  .strict();

function readSpec(dir: string): FixtureSpec {
  return SpecSchema.parse(JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')));
}

/** `fixtures/<rule>/<case>/fixture.json` 전수(base 제외). */
export function listCases(): FixtureCase[] {
  const out: FixtureCase[] = [];
  for (const rule of readdirSync(FIXTURES).sort()) {
    if (rule === 'base') {
      continue;
    }
    for (const name of readdirSync(join(FIXTURES, rule)).sort()) {
      const dir = join(FIXTURES, rule, name);
      out.push({ rule, name, dir, spec: readSpec(dir) });
    }
  }
  return out;
}

export type Run = { readonly code: number; readonly stdout: string; readonly stderr: string };

/** main()을 돌리고 stdout·stderr를 모은다(실제 터미널 출력 0). */
export function run(argv: readonly string[]): Run {
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
    return { code, stdout: out.join(''), stderr: errOut.join('') };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

export function lines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

export function ensureDir(dir: string): void {
  mkdirSync(dirname(dir), { recursive: true });
}

export type Mutation = {
  readonly replace?: readonly Patch[];
  readonly write?: Readonly<Record<string, string>>;
  readonly append?: Readonly<Record<string, string>>;
  readonly delete?: readonly string[];
};

/** base 트리 + 변형을 임시 디렉터리에 만든다. 돌려주는 root는 호출자가 rmTmp한다. */
export function mutatedTree(m: Mutation = {}): { root: string; contentDir: string } {
  const root = tmpRoot();
  const contentDir = materialize(root, { delete: m.delete ?? [], replace: m.replace ?? [] });
  for (const [rel, text] of Object.entries(m.write ?? {})) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  for (const [rel, text] of Object.entries(m.append ?? {})) {
    const path = join(root, rel);
    writeFileSync(path, readFileSync(path, 'utf8') + text);
  }
  return { root, contentDir };
}
