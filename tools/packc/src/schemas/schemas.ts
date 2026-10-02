// schemas(PGM-PACKC-011): V1 zod → `<content>/.schemas/<name>.schema.json` 12개(편집기 검증용 JSON Schema).
// 직렬화는 biome JSON 포맷(들여쓰기 2칸·줄 너비 120)과 같아야 한다 — 생성물은 커밋 대상이고 pnpm lint가 검사한다.
// 객체는 항상 펼치고, 원시값만 든 배열은 줄 너비 안이면 한 줄로 쓴다. 멱등.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FileKind } from '../parse/discover.js';
import { V1_SCHEMAS } from '../validate/v1-schema.js';

/** 스키마 파일 이름(DCP §13 견본 주석의 kus·items·pack `.schema.json`과 일치). */
export const SCHEMA_NAMES: { readonly [K in FileKind]: string } = {
  pack: 'pack',
  concept: 'concepts',
  kus: 'kus',
  misconceptions: 'misconceptions',
  items: 'items',
  'item-models': 'item-models',
  'templates-t2': 'templates-t2',
  'templates-dig': 'templates-dig',
  rubrics: 'rubrics',
  'sources-registry': 'sources-registry',
  'sources-requests': 'sources-requests',
  'review-v7': 'review-v7',
};

const KINDS: readonly FileKind[] = [
  'pack',
  'concept',
  'kus',
  'misconceptions',
  'items',
  'item-models',
  'templates-t2',
  'templates-dig',
  'rubrics',
  'sources-registry',
  'sources-requests',
  'review-v7',
];

const LINE_WIDTH = 120;

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** biome 포맷과 같은 JSON 직렬화(끝 줄바꿈 없음). `prefix` = 이 값 앞에 이미 쓴 글자(들여쓰기·키·쉼표 여유). */
export function formatJson(value: unknown, indent = 0, prefixWidth = 0): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const primitive = value.every((x) => typeof x !== 'object' || x === null);
    if (primitive) {
      const single = `[${value.map((x) => JSON.stringify(x)).join(', ')}]`;
      if (prefixWidth + single.length + 1 <= LINE_WIDTH) {
        return single;
      }
    }
    const items = value.map((x) => `${inner}${formatJson(x, indent + 1, inner.length)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (isPlain(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    const members = keys.map((k) => {
      const head = `${inner}${JSON.stringify(k)}: `;
      return `${head}${formatJson(value[k], indent + 1, head.length)}`;
    });
    return `{\n${members.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

export type SchemaFile = { readonly name: string; readonly file: string; readonly text: string };

/** 12개 JSON Schema 텍스트(이름 사전순). */
export function renderSchemas(): SchemaFile[] {
  const out: SchemaFile[] = [];
  for (const kind of KINDS) {
    const name = SCHEMA_NAMES[kind];
    const json = z.toJSONSchema(V1_SCHEMAS[kind], { io: 'input', unrepresentable: 'any' });
    out.push({ name, file: `${name}.schema.json`, text: `${formatJson(json)}\n` });
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export type SchemaSummary = { readonly written: number; readonly stale: readonly string[] };

/** `<content>/.schemas`에 쓴다(`check`면 쓰지 않고 차이만 — 차이 줄 `stale <file>`). */
export function writeSchemas(contentDir: string, check: boolean): SchemaSummary {
  const dir = join(contentDir, '.schemas');
  const stale: string[] = [];
  let written = 0;
  if (!check) {
    mkdirSync(dir, { recursive: true });
  }
  for (const s of renderSchemas()) {
    const path = join(dir, s.file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (check) {
      if (current !== s.text) {
        stale.push(s.file);
      }
      continue;
    }
    if (current !== s.text) {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, s.text, 'utf8');
      renameSync(tmp, path);
      written += 1;
    }
  }
  return { written, stale };
}
