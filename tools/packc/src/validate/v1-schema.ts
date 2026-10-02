// V1 — §4.2 표의 스키마로 safeParse(Brief T-01-03 §4.4). 이슈마다 error(rule 'V1', keypath = issue.path.join('.')).
// R-FMT 사전 검사: items 파일은 union 파싱 전에 각 items.<key>.format을 본다 — FormatId 밖 또는 NON_AUTHORING = R-FMT error.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PACKC_VERSION } from '../emit/manifest.js';
import { isAuthoringFormat, isNonAuthoringFormat } from '../format-map.js';
import type { FileKind } from '../parse/discover.js';
import { parseBody } from '../parse/markdown.js';
import type { RawFile } from '../parse/load.js';
import { ConceptFrontmatter } from '../parse/schema/concept.js';
import { ItemFile } from '../parse/schema/item.js';
import { ItemModelFile } from '../parse/schema/item-model.js';
import { KuFile } from '../parse/schema/ku.js';
import { McFile } from '../parse/schema/misconception.js';
import { PackYaml } from '../parse/schema/pack.js';
import { RubricFile } from '../parse/schema/rubric.js';
import { SourceRegistry } from '../parse/schema/source.js';
import { SourceRequestFile, TemplateDigFile, TemplateT2File } from '../parse/schema/template.js';
import { V7Record } from '../parse/schema/v7.js';
import { finding } from './finding.js';
import type { Finding } from './finding.js';
import type { LoadedFile } from './model.js';

export type V1Context = { readonly policyDir: string };

/** 파일 종류 → V1 스키마(§4.2 표). `packc schemas`가 같은 표로 JSON Schema 12개를 낸다. */
export const V1_SCHEMAS: { readonly [K in FileKind]: z.ZodType } = {
  pack: PackYaml,
  concept: ConceptFrontmatter,
  kus: KuFile,
  misconceptions: McFile,
  items: ItemFile,
  'item-models': ItemModelFile,
  rubrics: RubricFile,
  'templates-t2': TemplateT2File,
  'templates-dig': TemplateDigFile,
  'sources-registry': SourceRegistry,
  'sources-requests': SourceRequestFile,
  'review-v7': V7Record,
};

function pathText(path: readonly PropertyKey[]): string {
  return path.map(String).join('.');
}

/** zod 이슈 → V1 finding. `unrecognized_keys`는 키마다 한 건(keypath에 키 포함). */
export function issueFindings(file: string, issues: readonly z.core.$ZodIssue[]): Finding[] {
  const out: Finding[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const base = pathText(issue.path);
        out.push(finding('V1', 'error', file, base === '' ? key : `${base}.${key}`, `unrecognized key "${key}"`));
      }
      continue;
    }
    out.push(finding('V1', 'error', file, pathText(issue.path), issue.message));
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** R-FMT 사전 검사 — 위반 문항을 뺀 데이터 사본과 finding 목록. */
function preCheckItems(file: string, data: unknown): { data: unknown; findings: Finding[] } {
  if (!isRecord(data) || !isRecord(data.items)) {
    return { data, findings: [] };
  }
  const findings: Finding[] = [];
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(data.items)) {
    const format = isRecord(item) ? item.format : undefined;
    if (typeof format === 'string' && !isAuthoringFormat(format)) {
      const why = isNonAuthoringFormat(format) ? 'runtime-only format' : 'not an IF-01 FormatId';
      findings.push(finding('R-FMT', 'error', file, `items.${key}.format`, `format '${format}' cannot be authored (${why})`));
      continue;
    }
    kept[key] = item;
  }
  return { data: { ...data, items: kept }, findings };
}

type SemverTriple = readonly [number, number, number];

function triple(s: string): SemverTriple {
  const [a, b, c] = s.split('.').map((x) => Number.parseInt(x, 10));
  return [a ?? 0, b ?? 0, c ?? 0];
}

function cmpTriple(a: SemverTriple, b: SemverTriple): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

const RANGE_RE = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/;

function packExtras(file: string, track: string, pack: PackYaml, ctx: V1Context): Finding[] {
  const out: Finding[] = [];
  if (pack.id !== track) {
    out.push(finding('V1', 'error', file, 'id', `id '${pack.id}' must equal the directory name '${track}'`));
  }
  if (pack.track.id !== pack.id) {
    out.push(finding('V1', 'error', file, 'track.id', `track.id '${pack.track.id}' must equal id '${pack.id}'`));
  }
  const m = RANGE_RE.exec(pack.requires.packc);
  if (m === null) {
    out.push(finding('V1', 'error', file, 'requires.packc', 'must match ">=X.Y.Z <X.Y.Z"'));
  } else {
    const lo = triple(m[1] ?? '0.0.0');
    const hi = triple(m[2] ?? '0.0.0');
    const cur = triple(PACKC_VERSION);
    if (cmpTriple(cur, lo) < 0 || cmpTriple(cur, hi) >= 0) {
      out.push(finding('V1', 'error', file, 'requires.packc', `packc ${PACKC_VERSION} does not satisfy ${pack.requires.packc}`));
    }
  }
  for (const [name, v] of Object.entries(pack.requires.policy)) {
    if (!existsSync(join(ctx.policyDir, `${name}@${v}.yaml`))) {
      out.push(finding('V1', 'error', file, `requires.policy.${name}`, `policy file ${name}@${v}.yaml not found`));
    }
  }
  return out;
}

export type V1Result = { readonly file: LoadedFile | null; readonly findings: readonly Finding[] };

/** 한 파일의 V1 검사. 통과하면 file(타입 확정), 실패하면 null. */
export function validateV1(raw: RawFile, ctx: V1Context): V1Result {
  const { disc } = raw;
  const rel = disc.rel;
  const meta = { rel, disc };
  let data: unknown = raw.data;
  const findings: Finding[] = [];
  if (disc.kind === 'items') {
    const pre = preCheckItems(rel, data);
    data = pre.data;
    findings.push(...pre.findings);
  }
  const parsed = V1_SCHEMAS[disc.kind].safeParse(data);
  if (!parsed.success) {
    findings.push(...issueFindings(rel, parsed.error.issues));
    return { file: null, findings };
  }
  const value: unknown = parsed.data;
  const loaded = narrow(disc.kind, meta, value, raw.body);
  if (loaded === null) {
    findings.push(finding('V1', 'error', rel, '', 'internal: unexpected parsed value'));
    return { file: null, findings };
  }
  if (loaded.kind === 'pack') {
    const extra = packExtras(rel, disc.track ?? '', loaded.data, ctx);
    findings.push(...extra);
    if (extra.length > 0) {
      return { file: null, findings };
    }
  }
  return { file: findings.some((f) => f.severity === 'error') ? null : loaded, findings };
}

function narrow(kind: FileKind, meta: { rel: string; disc: RawFile['disc'] }, value: unknown, body: string | null): LoadedFile | null {
  switch (kind) {
    case 'pack':
      return { ...meta, kind, data: PackYaml.parse(value) };
    case 'concept':
      return { ...meta, kind, data: ConceptFrontmatter.parse(value), body: parseBody(body ?? '') };
    case 'kus':
      return { ...meta, kind, data: KuFile.parse(value) };
    case 'misconceptions':
      return { ...meta, kind, data: McFile.parse(value) };
    case 'items':
      return { ...meta, kind, data: ItemFile.parse(value) };
    case 'item-models':
      return { ...meta, kind, data: ItemModelFile.parse(value) };
    case 'rubrics':
      return { ...meta, kind, data: RubricFile.parse(value) };
    case 'templates-t2':
      return { ...meta, kind, data: TemplateT2File.parse(value) };
    case 'templates-dig':
      return { ...meta, kind, data: TemplateDigFile.parse(value) };
    case 'sources-registry':
      return { ...meta, kind, data: SourceRegistry.parse(value) };
    case 'sources-requests':
      return { ...meta, kind, data: SourceRequestFile.parse(value) };
    case 'review-v7':
      return { ...meta, kind, data: V7Record.parse(value) };
    default:
      return null;
  }
}
