// 파일 읽기·인코딩 검사·YAML(frontmatter) 파싱. YAML은 parseYamlStrict 단일 경로(앵커·별칭·중복 키·__proto__ 거부).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import type { Finding } from '../validate/finding.js';
import { finding } from '../validate/finding.js';
import type { DiscoveredFile } from './discover.js';
import { splitFrontmatter } from './frontmatter.js';

export type RawFile = {
  readonly disc: DiscoveredFile;
  /** YAML 파싱 결과(개념 파일은 frontmatter). */
  readonly data: unknown;
  /** 개념 파일 본문(frontmatter 닫는 줄 다음부터). */
  readonly body: string | null;
};

export type LoadResult = { readonly raw: RawFile | null; readonly findings: readonly Finding[] };

function v1(file: string, code: string, detail: string): Finding {
  return finding('V1', 'error', file, '', `${code}: ${detail}`);
}

/** 파일 하나를 읽고 파싱한다. 실패 = V1 finding(`encoding`·`frontmatter`·`yaml`)이고 raw = null. */
export function loadFile(contentDir: string, disc: DiscoveredFile): LoadResult {
  const bytes = readFileSync(join(contentDir, disc.rel));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { raw: null, findings: [v1(disc.rel, 'encoding', 'UTF-8 BOM is not allowed')] };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { raw: null, findings: [v1(disc.rel, 'encoding', 'file is not valid UTF-8')] };
  }
  if (text.includes('\r')) {
    return { raw: null, findings: [v1(disc.rel, 'encoding', 'CR (CRLF line endings) is not allowed, use LF')] };
  }
  if (disc.kind === 'concept') {
    if (!disc.base.endsWith('.md')) {
      return { raw: null, findings: [v1(disc.rel, 'frontmatter', 'concept file must be a .md file')] };
    }
    const split = splitFrontmatter(text);
    if (!split.ok) {
      return { raw: null, findings: [v1(disc.rel, 'frontmatter', split.error)] };
    }
    const parsed = parseYamlStrict(split.value.yaml);
    if (!parsed.ok) {
      return { raw: null, findings: [v1(disc.rel, 'yaml', parsed.error.detail)] };
    }
    return { raw: { disc, data: parsed.value, body: split.value.body }, findings: [] };
  }
  const parsed = parseYamlStrict(text);
  if (!parsed.ok) {
    return { raw: null, findings: [v1(disc.rel, 'yaml', parsed.error.detail)] };
  }
  return { raw: { disc, data: parsed.value, body: null }, findings: [] };
}
