import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// UT-CON-003 — 제출 전 스키마 가드(Brief §4.8). 소스 어휘 검사기 + 실파일 스캔(0개 허용).
const FORBIDDEN_KEYS = [
  'answer_key',
  'explanation',
  'is_correct',
  'model_answer',
  'exemplar_note',
  'solution',
] as const;
const KEY_ALT = `(?:${FORBIDDEN_KEYS.join('|')}|correct_[A-Za-z0-9_]*)`;
const FORBIDDEN_KEY_RE = new RegExp(`(?<![A-Za-z0-9_])['"]?${KEY_ALT}['"]?\\s*:`, 'g');
const POST_SUBMIT_IMPORT_RE = /(?:from|import)\s*\(?\s*['"][^'"\n]*post-submit[^'"\n]*['"]/g;
const DERIVE_RE = /\.(?:extend|merge|pick|omit)\s*\(/g;

/** 주석을 지운 뒤 위반 항목을 모은다(주석의 금지어 언급은 위반이 아니다). */
function scanPreSubmitSource(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const found: string[] = [];
  for (const m of code.matchAll(FORBIDDEN_KEY_RE)) {
    found.push(`forbidden-key:${m[0].replace(/[\s:'"]/g, '')}`);
  }
  for (const m of code.matchAll(POST_SUBMIT_IMPORT_RE)) {
    found.push(`post-submit-import:${m[0]}`);
  }
  for (const m of code.matchAll(DERIVE_RE)) {
    found.push(`derive:${m[0]}`);
  }
  return found;
}

async function listPreSubmitFiles(): Promise<string[]> {
  const httpDir = fileURLToPath(new URL('../../../src/http', import.meta.url));
  const files: string[] = [];
  let services: string[] = [];
  try {
    services = await readdir(httpDir);
  } catch {
    return files; // src/http가 아직 없다 — 0개 허용
  }
  for (const svc of services) {
    const dir = join(httpDir, svc, 'v1', 'pre-submit');
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('.ts')) {
        files.push(join(dir, name));
      }
    }
  }
  return files;
}

describe('presubmit guard', () => {
  it('UT-CON-003 pre-submit 스키마 파일에 정답 필드·post-submit import·파생 호출이 없다 [FR-QST-022][NFR-UX-008]', async () => {
    const files = await listPreSubmitFiles(); // 파일이 생기면 자동으로 범위에 들어간다
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      expect(scanPreSubmitSource(text), file).toEqual([]);
    }

    for (const key of FORBIDDEN_KEYS) {
      expect(scanPreSubmitSource(`export const X = S({ ${key}: z.string() });`), key).not.toEqual([]);
      expect(scanPreSubmitSource(`export const X = S({ '${key}': z.string() });`), `'${key}'`).not.toEqual([]);
    }
    expect(scanPreSubmitSource('export const X = S({ correct_option: ObjKey });')).not.toEqual([]);
    expect(scanPreSubmitSource('export const X = S({ correct_keys: z.array(ObjKey) });')).not.toEqual([]);
    expect(scanPreSubmitSource("import { Post } from '../post-submit/attempt.js';")).not.toEqual([]);
    expect(scanPreSubmitSource("export * from '../post-submit/attempt.js';")).not.toEqual([]);
    expect(scanPreSubmitSource('export const X = Base.extend({ a: z.string() });')).not.toEqual([]);
    expect(scanPreSubmitSource('export const X = Base.merge(Other);')).not.toEqual([]);
    expect(scanPreSubmitSource('export const X = Base.pick({ a: true });')).not.toEqual([]);
    expect(scanPreSubmitSource('export const X = Base.omit({ a: true });')).not.toEqual([]);

    const clean = [
      '// 금지 필드 0 — answer_key·explanation·correct_*·is_correct·model_answer·exemplar_note·solution',
      '/* solution: 예시 */',
      "import { z } from 'zod';",
      'export const ItemPreSubmit = S({ item_id: ItemId, stem_md: z.string(), options: z.array(OptionView) });',
    ].join('\n');
    expect(scanPreSubmitSource(clean)).toEqual([]);
    expect(scanPreSubmitSource('export const A = S({ correction_note: z.string() });')).toEqual([]);
  });
});
