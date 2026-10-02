import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';

// 테스트 전용 `.fpack` 작성기 — T-01-03 Brief §4.8 ①~⑦ 규칙 그대로의 최소 구현(결정적 바이트).
// 판독기(infra/packs)를 재사용하지 않고 같은 규칙을 독립 구현해, 두 쪽이 같은 바이트 형식에 합의하는지를 검증한다.

export const FIXED_CREATED_AT = 1_790_000_000_000;
const BLOCK = 512;

// ───────── ustar ─────────
export type TarEntryInput = {
  readonly name: string;
  readonly bytes: Buffer;
  readonly typeflag?: string;
  readonly badChecksum?: boolean;
};
export type TarOptions = { readonly endBlocks?: number; readonly trailing?: Buffer; readonly truncateTo?: number };

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(entry: TarEntryInput): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(entry.name, 0, 'utf8');
  h.write('0000644\0', 100, 'latin1');
  h.write('0000000\0', 108, 'latin1');
  h.write('0000000\0', 116, 'latin1');
  h.write(octal(entry.bytes.length, 12), 124, 'latin1');
  h.write('00000000000\0', 136, 'latin1');
  h.fill(0x20, 148, 156);
  h.write(entry.typeflag ?? '0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) {
    sum += b;
  }
  const shown = entry.badChecksum === true ? sum + 1 : sum;
  h.write(`${shown.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

export function ustar(entries: readonly TarEntryInput[], opts: TarOptions = {}): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e));
    const padded = Math.ceil(e.bytes.length / BLOCK) * BLOCK;
    const data = Buffer.alloc(padded, 0);
    e.bytes.copy(data);
    parts.push(data);
  }
  parts.push(Buffer.alloc((opts.endBlocks ?? 2) * BLOCK, 0));
  if (opts.trailing !== undefined) {
    parts.push(opts.trailing);
  }
  const all = Buffer.concat(parts);
  return opts.truncateTo === undefined ? all : all.subarray(0, opts.truncateTo);
}

// ───────── merkle(독립 구현) ─────────
export function merkleOf(lines: readonly string[]): string {
  const h = (...bufs: Buffer[]): Buffer => {
    const x = createHash('sha256');
    for (const b of bufs) {
      x.update(b);
    }
    return x.digest();
  };
  let level = lines.map((l) => h(Buffer.from(l, 'utf8'))).sort(Buffer.compare);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i] as Buffer;
      const r = level[i + 1];
      next.push(r === undefined ? l : h(Buffer.from([1]), l, r));
    }
    level = next;
  }
  return (level[0] as Buffer).toString('hex');
}

// ───────── 레코드 ─────────
export type ConceptSpec = {
  readonly slug: string;
  readonly level?: number;
  readonly tier?: 'A' | 'B' | 'C';
  /** 바꾸면 content_hash가 달라진다(개정). */
  readonly rev?: number;
  readonly deprecated_by?: string | null;
  /** 같은 팩 개념 slug 목록 — prereq 간선(from = 그 개념, to = 이 개념). */
  readonly prereqs?: readonly string[];
  readonly kus?: number;
  readonly mcs?: number;
  /** KU 개정(해시 변경)을 일으킬 번호. */
  readonly ku_rev?: number;
  readonly required_for_level?: number | null;
  readonly items?: number;
};
export type PackSpec = {
  readonly track?: string;
  readonly version?: string;
  readonly channel?: 'seed' | 'local' | 'user';
  readonly concepts: readonly ConceptSpec[];
  readonly offline_cap_level?: number;
  readonly oracle_cap_level?: number;
  readonly sort_order?: number;
  readonly aliases?: readonly { alias_id: string; target_id: string }[];
  /** 번들 끝에 덧붙일 원시 레코드(이미 content_hash 포함). */
  readonly extra_records?: readonly Record<string, unknown>[];
  /** 같은 원천인데 manifest만 다르게(같은 버전 다른 hash 시나리오). */
  readonly created_at?: number;
  readonly counts_override?: Partial<{
    concepts: number;
    kus: number;
    misconceptions: number;
    items: number;
    cases: number;
  }>;
};

export function withHash<T extends Record<string, unknown>>(record: T): T & { content_hash: string } {
  return { ...record, content_hash: sha256Hex(canonicalJson(record)) };
}

const SOURCE_ID = 'src.k8s-docs';
const sourceRef = {
  source_id: SOURCE_ID,
  locator: 'https://example.com/docs',
  section: 'overview',
  usage: 'link_only',
  retrieved_at: '2026-09-01',
  product_version: null,
  quote: null,
};

export function trackRecord(
  track: string,
  over: { offline: number; oracle: number; sort_order: number },
): Record<string, unknown> {
  return withHash({
    kind: 'track',
    track_id: track,
    name_ko: `트랙 ${track}`,
    name_en: `Track ${track}`,
    track_group: 'infra',
    sort_order: over.sort_order,
    offline_cap_level: over.offline,
    oracle_cap_level: over.oracle,
    summary_ko: '테스트 트랙',
    ext: {},
  });
}

export function conceptRecord(track: string, c: ConceptSpec): Record<string, unknown> {
  return withHash({
    kind: 'concept',
    concept_id: `${track}.${c.slug}`,
    track_id: track,
    level: c.level ?? 1,
    knowledge_type: 'C',
    tier: c.tier ?? 'A',
    title_ko: `개념 ${c.slug}`,
    title_en: `Concept ${c.slug}`,
    summary_ko: `요약 ${c.slug} 개정 ${c.rev ?? 0}`,
    aliases: [`별칭-${c.slug}`],
    tags: ['stack:k8s'],
    volatility: 'stable',
    required_for_level: c.required_for_level ?? null,
    deprecated_by: c.deprecated_by ?? null,
    theory_md: `이론 ${c.slug}`,
    code_md: '',
    core_md: `핵심 ${c.slug}`,
    diagrams: {},
    sources: [],
    ext: {},
  });
}

export function kuRecord(track: string, slug: string, n: number, rev: number): Record<string, unknown> {
  const cid = `${track}.${slug}`;
  const key = `k${String(n).padStart(2, '0')}`;
  return withHash({
    kind: 'ku',
    ku_id: `${cid}.${key}`,
    concept_id: cid,
    statement: `${cid} 지식 단위 ${n} 개정 ${rev}`,
    facet: 'concept',
    scope: '',
    vol: 'stable',
    valid_as_of: '2026-09-01',
    deprecated_by: null,
    source_refs: [sourceRef],
    trust: 'authored',
    origin: 'authored',
    status: 'published',
    ext: {},
  });
}

export function mcRecord(track: string, slug: string, n: number): Record<string, unknown> {
  const cid = `${track}.${slug}`;
  return withHash({
    kind: 'misconception',
    mc_id: `${cid}.m${String(n).padStart(2, '0')}`,
    concept_id: cid,
    statement: `${cid} 오개념 ${n} 설명문`,
    correction: `${cid} 오개념 ${n} 교정문 입니다`,
    meta_family: 'mf_overgeneral',
    related_ku_ids: [`${cid}.k01`],
    status: 'active',
    ext: {},
  });
}

export function itemRecord(track: string, slug: string, n: number): Record<string, unknown> {
  const cid = `${track}.${slug}`;
  return withHash({
    kind: 'item',
    item_id: `${cid}.i${String(n).padStart(2, '0')}`,
    origin: 'pack',
    model_id: null,
    family_id: `seed:${track}@1`,
    concept_id: cid,
    ku_ids: [`${cid}.k01`],
    mc_ids: [],
    facet: 'concept',
    format: 'ox',
    response_mode: 'recognition',
    level: 1,
    bloom: 'remember',
    stakes: 'S0',
    tier: 'A',
    n_options: 2,
    beta_prior: 0,
    stem: { md: '문항 본문' },
    options: {},
    answer_key: { answer: true, false_mc: null, correction_md: '교정' },
    explanation_md: '해설',
    distractor_mc: {},
    lab_id: null,
    source_kind: 'seed',
    stem_family: 'sf_basic',
    gate_status: 'authored',
    defect_manifest: null,
    s2_mode: null,
    lineage: {},
    snapshot: {},
    ext: {},
  });
}

export function gateResultRecord(itemId: string, contentHash: string): Record<string, unknown> {
  return {
    kind: 'gate_result',
    gate_result_id: '01J0000000000000000000000A',
    subject_kind: 'item',
    subject_id: itemId,
    content_hash: contentHash,
    gate: 'V7',
    engine: 'USER',
    provider_id: null,
    run_context: 'seed_build',
    pass: true,
    score: null,
    probabilities: null,
    detail: {},
  };
}

const KIND_RANK: Readonly<Record<string, number>> = {
  track: 0,
  source: 1,
  rubric: 2,
  concept: 3,
  edge: 4,
  alias: 5,
  ku: 6,
  misconception: 7,
  item_model: 8,
  item: 9,
  gate_result: 10,
  case: 11,
  artifact: 12,
  lab: 13,
  path: 14,
};
const KEY_FIELDS = [
  'track_id',
  'source_id',
  'rubric_id',
  'concept_id',
  'alias_id',
  'ku_id',
  'mc_id',
  'model_id',
  'item_id',
  'subject_id',
] as const;

function sortKey(r: Record<string, unknown>): string {
  if (r.kind === 'edge') {
    return `${String(r.from_concept_id)}|${String(r.to_concept_id)}|${String(r.edge_kind)}`;
  }
  for (const f of KEY_FIELDS) {
    if (typeof r[f] === 'string') {
      return r[f];
    }
  }
  return '';
}

export function buildRecords(spec: PackSpec): Record<string, unknown>[] {
  const track = spec.track ?? 'k8s';
  const records: Record<string, unknown>[] = [
    trackRecord(track, {
      offline: spec.offline_cap_level ?? 2,
      oracle: spec.oracle_cap_level ?? 3,
      sort_order: spec.sort_order ?? 10,
    }),
    withHash({
      kind: 'source',
      source_type: 'doc',
      source_id: SOURCE_ID,
      title: '테스트 출처',
      url: 'https://example.com/docs',
      ref_text: null,
      license_grade: 'A',
      fetched_at: null,
      ext: {},
    }),
    withHash({
      kind: 'rubric',
      rubric_id: 'rb.basic',
      dims: { dims: { d_main: { name: '주 차원', weight: 1, levels: { l1: '미흡', l3: '충분' } } } },
      ext: {},
    }),
  ];
  for (const c of spec.concepts) {
    records.push(conceptRecord(track, c));
    for (let n = 1; n <= (c.kus ?? 1); n += 1) {
      records.push(kuRecord(track, c.slug, n, c.ku_rev ?? 0));
    }
    for (let n = 1; n <= (c.mcs ?? 0); n += 1) {
      records.push(mcRecord(track, c.slug, n));
    }
    for (let n = 1; n <= (c.items ?? 0); n += 1) {
      records.push(itemRecord(track, c.slug, n));
    }
    for (const p of c.prereqs ?? []) {
      records.push({
        kind: 'edge',
        from_concept_id: `${track}.${p}`,
        to_concept_id: `${track}.${c.slug}`,
        edge_kind: 'prereq',
        weight: 1,
      });
    }
  }
  for (const a of spec.aliases ?? []) {
    records.push({ kind: 'alias', entity_kind: 'concept', alias_id: a.alias_id, target_id: a.target_id });
  }
  records.push(...(spec.extra_records ?? []));
  return records.sort((a, b) => {
    const ra = KIND_RANK[String(a.kind)] ?? 99;
    const rb = KIND_RANK[String(b.kind)] ?? 99;
    if (ra !== rb) {
      return ra - rb;
    }
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });
}

// ───────── 조립 ─────────
export type FpackParts = {
  manifest: Record<string, unknown> & { files: { path: string; sha256: string; bytes: number }[] };
  lines: string[];
  report: Record<string, unknown>;
  layout: Record<string, unknown>;
};
export type Tamper = {
  /** 일관되게 만든 부품을 조립 전에 바꾼다. */
  readonly parts?: (p: FpackParts) => void;
  /** false면 manifest.files를 다시 계산하지 않는다(파일 해시 불일치 시나리오). */
  readonly refreshFiles?: boolean;
  readonly bundleBytes?: (b: Buffer) => Buffer;
  readonly entries?: (e: TarEntryInput[]) => TarEntryInput[];
  readonly tar?: TarOptions;
  readonly final?: (bytes: Buffer) => Buffer;
};
export type BuiltFpack = {
  readonly bytes: Buffer;
  readonly parts: FpackParts;
  readonly records: Record<string, unknown>[];
  readonly sha256: string;
  readonly manifest_hash: string;
};

export function buildParts(spec: PackSpec): { parts: FpackParts; records: Record<string, unknown>[] } {
  const track = spec.track ?? 'k8s';
  const records = buildRecords(spec);
  const lines = records.map((r) => canonicalJson(r));
  const count = (k: string): number => records.filter((r) => r.kind === k).length;
  const tiers = { A: 0, B: 0, C: 0 };
  for (const r of records) {
    if (r.kind === 'concept') {
      tiers[r.tier as 'A' | 'B' | 'C'] += 1;
    }
  }
  const n = Math.max(1, count('concept'));
  const report = {
    cap_blockers: [],
    kpi: {
      offline_learnable: count('concept'),
      three_stage: { full: tiers.A / n, lite: tiers.B / n, skeleton: tiers.C / n },
    },
    schema_v: 1,
    tier_counts: tiers,
    validators: { V1: { errors: 0, status: 'pass', warnings: 0 } },
  };
  const manifest = {
    pack_id: track,
    track,
    version: spec.version ?? '1.0.0',
    channel: spec.channel ?? 'seed',
    schema_v: 1,
    packc_version: '0.1.0',
    files: [] as { path: string; sha256: string; bytes: number }[],
    merkle_root: merkleOf(lines),
    counts: {
      concepts: count('concept'),
      kus: count('ku'),
      misconceptions: count('misconception'),
      items: count('item'),
      cases: count('case'),
      ...spec.counts_override,
    },
    required_for_level: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    // 매니페스트의 offline_cap_level은 Level(1~5)이라 0을 표현하지 못한다(트랙 레코드는 0~5) — 하한 1로 보정한다.
    offline_cap_level: Math.max(1, spec.offline_cap_level ?? 2),
    created_at: spec.created_at ?? FIXED_CREATED_AT,
  };
  return { parts: { manifest, lines, report, layout: { nodes: {}, schema_v: 1, status: 'deferred' } }, records };
}

const nl = (v: unknown): Buffer => Buffer.from(`${canonicalJson(v)}\n`, 'utf8');
const fileEntry = (name: string, bytes: Buffer): { path: string; sha256: string; bytes: number } => ({
  path: name,
  sha256: sha256Hex(bytes),
  bytes: bytes.length,
});

export function buildFpack(spec: PackSpec, tamper: Tamper = {}): BuiltFpack {
  const { parts, records } = buildParts(spec);
  tamper.parts?.(parts);
  let bundle: Buffer = Buffer.from(`${parts.lines.join('\n')}\n`, 'utf8');
  if (tamper.bundleBytes !== undefined) {
    bundle = tamper.bundleBytes(bundle);
  }
  const report = nl(parts.report);
  const layout = nl(parts.layout);
  if (tamper.refreshFiles !== false) {
    parts.manifest.files = [
      fileEntry('bundle.jsonl', bundle),
      fileEntry('report.json', report),
      fileEntry('layout.json', layout),
    ];
  }
  const manifest = nl(parts.manifest);
  let entries: TarEntryInput[] = [
    { name: 'manifest.json', bytes: manifest },
    { name: 'bundle.jsonl', bytes: bundle },
    { name: 'report.json', bytes: report },
    { name: 'layout.json', bytes: layout },
  ];
  if (tamper.entries !== undefined) {
    entries = tamper.entries(entries);
  }
  let bytes = ustar(entries, tamper.tar);
  if (tamper.final !== undefined) {
    bytes = tamper.final(bytes);
  }
  return { bytes, parts, records, sha256: sha256Hex(bytes), manifest_hash: sha256Hex(manifest) };
}

/** `<dir>/<pack_id>@<version>.fpack`(bundled 이름 규칙)로 쓴다. */
export function writeFpack(
  dir: string,
  spec: PackSpec,
  tamper: Tamper = {},
  fileName?: string,
): { file: string; built: BuiltFpack } {
  const built = buildFpack(spec, tamper);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName ?? `${spec.track ?? 'k8s'}@${spec.version ?? '1.0.0'}.fpack`);
  writeFileSync(file, built.bytes);
  return { file, built };
}

/** 개념 `n`개(slug `c001`…, 레벨 1~5 순환, 앞 개념을 선수로) — 대량 적재용. */
export function bulkConcepts(n: number, kus: number, mcs: number): ConceptSpec[] {
  return Array.from({ length: n }, (_, i) => {
    const slug = `c${String(i + 1).padStart(3, '0')}`;
    const prev = i === 0 ? [] : [`c${String(i).padStart(3, '0')}`];
    return { slug, level: (i % 5) + 1, prereqs: prev, kus, mcs };
  });
}
