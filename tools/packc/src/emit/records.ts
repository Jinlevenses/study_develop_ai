// 번들 레코드 생성(Brief T-01-03 §4.8-1 · DCP-01 §5.3). 먼저 content_hash 없는 "본문(body)"을 만들고(문항은 gate_status·s2_mode도 제외),
// V7 바인딩이 문항 상태를 정한 뒤 finalizePack()이 content_hash를 붙이고 BundleRecord.parse(G0)로 검증한다.

import type { BundleRecord as BundleRecordT } from '@fathom/contracts/pack/records';
import { BundleRecord } from '@fathom/contracts/pack/records';
import type { z } from 'zod';
import type { CapResult } from '../lint/inventory.js';
import { buildInventory, computeCap } from '../lint/inventory.js';
import { fencesOf, sectionText } from '../parse/markdown.js';
import type { SourceRef } from '../parse/schema/common.js';
import type { Item } from '../parse/schema/item.js';
import type { SourceEntry } from '../parse/schema/source.js';
import type { Finding } from '../validate/finding.js';
import { byCode, finding } from '../validate/finding.js';
import type {
  ConceptFile,
  ContentModel,
  ItemFileEntry,
  LintContext,
  PackFile,
  RubricFileEntry,
} from '../validate/model.js';
import { fullId } from '../validate/model.js';
import type { Rec } from './hash.js';
import { contentHash, subjectHash } from './hash.js';

export const KIND_ORDER = [
  'track',
  'source',
  'rubric',
  'concept',
  'edge',
  'alias',
  'ku',
  'misconception',
  'item_model',
  'item',
  'gate_result',
] as const;
export type RecordKind = (typeof KIND_ORDER)[number];

/** 정렬 키·원천 파일을 가진 레코드 본문. item은 gate_status·s2_mode·content_hash가 아직 없다. */
export type RecEntry = {
  readonly kind: RecordKind;
  readonly sort: readonly string[];
  readonly file: string;
  readonly rec: Rec;
};

export type ItemBody = {
  readonly itemId: string;
  readonly file: string;
  readonly format: string;
  readonly deferred: boolean;
  /** gate_status·s2_mode·content_hash를 뺀 본문. */
  readonly body: Rec;
  readonly subject: string;
};

export type PackBodies = {
  readonly packId: string;
  readonly version: string;
  readonly pack: PackFile;
  readonly concepts: readonly ConceptFile[];
  readonly entries: readonly RecEntry[];
  readonly items: readonly ItemBody[];
  readonly cap: CapResult;
  /** OFFLINE 산입 형식 문항 ≥ 1인 개념 수(report.kpi.offline_learnable). */
  readonly offlineLearnable: number;
  /** 개념·KU·MC·ItemModel 본문의 subject hash(= content_hash) — `hashes`용. */
  readonly subjects: ReadonlyMap<string, string>;
};

export type PackRecords = {
  readonly records: readonly BundleRecordT[];
  readonly findings: readonly Finding[];
};

function uniqSorted(list: readonly string[]): string[] {
  return [...new Set(list)].sort(byCode);
}

function packSourceRef(s: z.infer<typeof SourceRef>): Rec {
  return {
    source_id: s.source_id,
    locator: s.locator,
    section: s.section,
    usage: s.usage,
    retrieved_at: s.retrieved_at,
    product_version: s.product_version ?? null,
    quote: s.quote ?? null,
  };
}

function sourceEntryOf(model: ContentModel, id: string): SourceEntry | null {
  for (const r of model.registries) {
    const e = r.data.sources[id];
    if (e !== undefined) {
      return e;
    }
  }
  for (const r of model.requests) {
    const e = r.data.requests[id];
    if (e !== undefined) {
      return e;
    }
  }
  return null;
}

function rubricIdsOfItem(item: Item): string[] {
  switch (item.format) {
    case 'fermi':
      return item.assumptions_rubric === undefined ? [] : [item.assumptions_rubric];
    case 'blank_note':
      return [item.solo_rubric];
    case 'essay':
    case 'feynman':
      return [item.rubric];
    default:
      return [];
  }
}

type Code = { readonly lang: string; readonly src: string };

function codeRec(c: Code): Rec {
  return { lang: c.lang, src: c.src };
}

function mapValues<T>(rec: Readonly<Record<string, T>>, fn: (v: T, key: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (v !== undefined) {
      out[key] = fn(v, key);
    }
  }
  return out;
}

type ItemParts = {
  readonly stem: Rec;
  readonly options: Rec;
  readonly answer_key: Rec;
  readonly distractor_mc: Rec;
  readonly defect_manifest: Rec | null;
  readonly n_options: number | null;
};

/** 형식별 stem·options·answer_key 매핑(§4.8 문항 매핑 표). 정답·해설·모범답안·결함은 stem·options에 넣지 않는다. */
function itemParts(item: Item, cid: string): ItemParts {
  const mc = (ref: string): string => fullId(cid, ref);
  const ku = (ref: string): string => fullId(cid, ref);
  const distractors = (map: Readonly<Record<string, string>>): Rec => mapValues(map, (ref) => mc(ref));
  const optionMap = (map: Readonly<Record<string, string>>): Rec => ({ ...map });
  const none: Rec = {};
  const base = { distractor_mc: none, defect_manifest: null, n_options: null } as const;
  switch (item.format) {
    case 'ox':
      return {
        ...base,
        stem: { md: item.stem },
        options: none,
        answer_key: {
          answer: item.answer,
          false_mc: item.false_mc === undefined ? null : mc(item.false_mc),
          correction_md: item.correction_md,
        },
        n_options: 2,
      };
    case 'mcq':
      return {
        ...base,
        stem: { md: item.stem, code: item.code === undefined ? null : codeRec(item.code) },
        options: optionMap(item.options),
        answer_key: { answer: item.answer, option_rationale: { ...item.option_rationale } },
        distractor_mc: distractors(item.distractor_mc),
      };
    case 'mcq_multi':
      return {
        ...base,
        stem: { md: item.stem },
        options: optionMap(item.options),
        answer_key: { answer: Object.keys(item.answer).sort(byCode) },
      };
    case 'cloze':
      return {
        ...base,
        stem: { md: item.stem },
        options: none,
        answer_key: {
          blanks: mapValues(item.blanks, (b) => ({ accept: [...b.accept], normalize: { ...b.normalize } })),
        },
      };
    case 'short':
      return {
        ...base,
        stem: { md: item.stem },
        options: none,
        answer_key: {
          accept: [...item.accept],
          accept_regex: item.accept_regex ?? null,
          numeric: item.numeric === undefined ? null : { ...item.numeric },
          normalize: { ...item.normalize },
        },
      };
    case 'order':
      return {
        ...base,
        stem: { md: item.stem },
        options: optionMap(item.steps),
        answer_key: { answer: [...item.answer] },
      };
    case 'matching':
      return {
        ...base,
        stem: { md: item.stem },
        options: {
          ...mapValues(item.left, (md) => ({ side: 'left', md })),
          ...mapValues(item.right, (md) => ({ side: 'right', md })),
        },
        answer_key: { answer: { ...item.answer } },
      };
    case 'code_predict':
      return {
        ...base,
        stem: { md: item.stem, code: codeRec(item.code) },
        options: none,
        answer_key: item.answer === 'auto' ? { auto: true } : { stdout: item.answer.stdout },
      };
    case 'error_find':
      return {
        ...base,
        stem: { md: item.stem, code: codeRec(item.code) },
        options: none,
        answer_key: {
          from: item.answer.from,
          to: item.answer.to,
          bug_mc: item.bug_mc === undefined ? null : mc(item.bug_mc),
        },
      };
    case 'parsons':
      return {
        ...base,
        stem: { md: item.stem, lang: item.lang, indent: item.indent },
        options: optionMap(item.lines),
        answer_key: { answer: [...item.answer], distractors: [...item.distractors] },
      };
    case 'config_review':
      return {
        ...base,
        stem: { md: item.stem, artifact: codeRec(item.artifact) },
        options: none,
        answer_key: {},
        defect_manifest: mapValues(item.defect_manifest, (d) => {
          const { mc_ref, ...rest } = d;
          return mc_ref === undefined ? { ...rest } : { ...rest, mc_ref: mc(mc_ref) };
        }),
      };
    case 'log_read':
      return {
        ...base,
        stem: { md: item.stem, log: codeRec(item.log) },
        options: optionMap(item.options),
        answer_key: { answer: item.answer },
        distractor_mc: distractors(item.distractor_mc),
      };
    case 'cond_reversal':
      return {
        ...base,
        stem: { md: item.scenario, conditions: { cond_a: item.conditions.cond_a, cond_b: item.conditions.cond_b } },
        options: optionMap(item.options),
        answer_key: { answer: { cond_a: item.answer.cond_a, cond_b: item.answer.cond_b }, pivot_md: item.pivot_md },
      };
    case 'fermi':
      return {
        ...base,
        stem: { md: item.stem },
        options: none,
        answer_key: {
          value: item.answer.value,
          unit: item.answer.unit,
          log10_tol: item.answer.log10_tol,
          assumptions_rubric: item.assumptions_rubric ?? null,
        },
      };
    case 'blank_note':
      return {
        ...base,
        stem: { md: item.prompt },
        options: none,
        answer_key: {
          idea_units: mapValues(item.idea_units, (u) => ({
            text: u.text,
            ku_id: ku(u.ku_ref),
            weight: u.weight,
            keywords: [...u.keywords],
          })),
          solo_rubric: item.solo_rubric,
          model_note_md: item.model_note_md,
        },
      };
    case 'essay':
      return {
        ...base,
        stem: { md: item.prompt },
        options: none,
        answer_key: {
          key_points: mapValues(item.key_points, (p) => ({ text: p.text, ku_id: ku(p.ku_ref) })),
          rubric: item.rubric,
          model_answer_md: item.model_answer_md,
        },
      };
    case 'digging':
      return {
        ...base,
        stem: { md: item.question, depth: item.depth },
        options: none,
        answer_key: {
          expects: mapValues(item.expects, (p) => ({ text: p.text, ku_id: ku(p.ku_ref) })),
          followups: mapValues(item.followups, (fu) => ({
            when: fu.when,
            question: fu.question,
            ...(fu.mc_ref === undefined ? {} : { mc_id: mc(fu.mc_ref) }),
          })),
        },
      };
    case 'digging_d4_mcq':
      return {
        ...base,
        stem: { md: item.stem, depth: item.depth },
        options: optionMap(item.options),
        answer_key: { answer: item.answer },
        distractor_mc: distractors(item.distractor_mc),
      };
    case 'feynman':
      return {
        ...base,
        stem: {
          md: item.student_persona,
          student_beliefs: mapValues(item.student_beliefs, (b) => ({
            mc_id: mc(b.mc_ref),
            opening_line: b.opening_line,
          })),
        },
        options: none,
        answer_key: {
          checklist: mapValues(item.checklist, (c) => ({ text: c.text, ku_id: ku(c.ku_ref) })),
          rubric: item.rubric,
        },
      };
    case 'audit':
      return {
        ...base,
        stem: { md: item.prompt, artifact_md: item.artifact_md },
        options: none,
        answer_key: {},
        defect_manifest: mapValues(item.defect_manifest, (d) => {
          const { mc_ref, ...rest } = d;
          return mc_ref === undefined ? { ...rest } : { ...rest, mc_ref: mc(mc_ref) };
        }),
      };
    case 'pr_review':
      return {
        ...base,
        stem: { md: item.prompt, diff: codeRec(item.diff) },
        options: none,
        answer_key: {},
        defect_manifest: mapValues(item.defect_manifest, (d) => ({ ...d })),
      };
    case 'embedded':
      return {
        ...base,
        stem: { md: item.stem, shape: item.shape },
        options: item.shape === 'mcq' && item.options !== undefined ? optionMap(item.options) : none,
        answer_key: { answer: item.answer, false_mc: item.false_mc === undefined ? null : mc(item.false_mc) },
        n_options: item.shape === 'ox' ? 2 : null,
      };
    default:
      return assertUnreachable(item);
  }
}

function assertUnreachable(x: never): never {
  throw new Error(`invariant: unsupported item format ${JSON.stringify(x)}`);
}

function itemBody(
  f: ItemFileEntry,
  key: string,
  item: Item,
  concept: ConceptFile,
  ctx: LintContext,
  packId: string,
  version: string,
): ItemBody {
  const cid = f.data.concept_id;
  const itemId = `${cid}.${key}`;
  const kuIds = uniqSorted(item.ku_refs.map((r) => fullId(cid, r)));
  const mcIds = uniqSorted(item.mc_refs.map((r) => fullId(cid, r)));
  const parts = itemParts(item, cid);
  const kuSnap: Record<string, unknown> = {};
  for (const id of kuIds) {
    const [c, k] = splitId(id);
    const statement = ctx.idx.kusByConcept.get(c)?.data.kus[k]?.statement;
    if (statement !== undefined) {
      kuSnap[id] = statement;
    }
  }
  const mcSnap: Record<string, unknown> = {};
  for (const id of mcIds) {
    const [c, k] = splitId(id);
    const belief = ctx.idx.mcsByConcept.get(c)?.data.mcs[k]?.wrong_belief;
    if (belief !== undefined) {
      mcSnap[id] = belief;
    }
  }
  const ext: Record<string, unknown> = { 'pack.roles': [...item.roles], 'pack.tags': [...item.tags] };
  if (item.hints !== undefined) {
    ext['pack.hints'] = { ...item.hints };
  }
  const body: Rec = {
    kind: 'item',
    item_id: itemId,
    origin: 'pack',
    model_id: null,
    family_id: `seed:${packId}@${version.split('.')[0] ?? '0'}`,
    concept_id: cid,
    ku_ids: kuIds,
    mc_ids: mcIds,
    facet: item.facet,
    format: item.format,
    response_mode: item.response_mode,
    level: item.level,
    bloom: item.bloom,
    stakes: item.stakes,
    tier: concept.data.tier,
    n_options: parts.n_options ?? Object.keys(parts.options).length,
    beta_prior: 0,
    stem: parts.stem,
    options: parts.options,
    answer_key: parts.answer_key,
    explanation_md: item.explanation_md,
    distractor_mc: parts.distractor_mc,
    lab_id: null,
    source_kind: 'seed',
    stem_family: item.stem_family,
    defect_manifest: parts.defect_manifest,
    lineage: {},
    snapshot: { kus: kuSnap, mcs: mcSnap },
    ext,
  };
  return {
    itemId,
    file: f.rel,
    format: item.format,
    deferred: item.format === 'code_predict' && item.answer === 'auto',
    body,
    subject: subjectHash(body),
  };
}

function splitId(id: string): [string, string] {
  const i = id.lastIndexOf('.');
  return [id.slice(0, i), id.slice(i + 1)];
}

function rubricEntry(r: RubricFileEntry): RecEntry {
  const d = r.data;
  const total = Object.values(d.dims).reduce((s, x) => s + x.weight, 0);
  const dims: Record<string, unknown> = {};
  const raw: Record<string, unknown> = {};
  for (const [key, dim] of Object.entries(d.dims)) {
    raw[key] = dim.weight;
    dims[key] = {
      name: dim.name_ko,
      weight: total === 0 ? 0 : dim.weight / total,
      levels: { l1: dim.levels.l1, l2: dim.levels.l2, l3: dim.levels.l3, l4: dim.levels.l4 },
    };
  }
  return {
    kind: 'rubric',
    sort: [d.id],
    file: r.rel,
    rec: {
      kind: 'rubric',
      rubric_id: d.id,
      dims: { dims },
      ext: {
        'pack.title_ko': d.title_ko,
        'pack.applies_to': [...d.applies_to],
        'pack.pass_mean': d.pass_mean,
        'pack.raw_weights': raw,
      },
    },
  };
}

function sourceEntryRec(model: ContentModel, id: string): RecEntry | null {
  const e = sourceEntryOf(model, id);
  if (e === null) {
    return null;
  }
  const license: Record<string, unknown> = { ...e.license };
  const ext: Record<string, unknown> = {
    'pack.license': license,
    'pack.publisher': e.publisher,
    'pack.attribution_template': e.attribution_template,
    'pack.allowed_usage': [...e.allowed_usage],
    'pack.primary': e.primary,
    'pack.versioned_by': e.versioned_by,
  };
  if (e.code_license !== undefined) {
    ext['pack.code_license'] = { ...e.code_license };
  }
  return {
    kind: 'source',
    sort: [id],
    file: 'sources/registry.yaml',
    rec: {
      kind: 'source',
      source_id: id,
      source_type: e.kind,
      title: e.title,
      url: e.base_url ?? (e.repo === undefined ? null : `https://${e.repo}`),
      ref_text: e.ref_text ?? null,
      license_grade: e.license.grade,
      fetched_at: null,
      ext,
    },
  };
}

function conceptEntries(c: ConceptFile): RecEntry[] {
  const d = c.data;
  const out: RecEntry[] = [];
  const sec = (title: string): string => {
    const s = c.body.sections.find((x) => x.title === title);
    return s === undefined ? '' : sectionText(s);
  };
  const mermaid: Record<string, string> = {};
  for (const s of c.body.sections) {
    for (const f of fencesOf(s.lines)) {
      if (f.lang === 'mermaid' && f.key !== null) {
        mermaid[f.key] = f.content;
      }
    }
  }
  const diagrams = mapValues(d.diagrams, (g, key) => ({ mermaid: mermaid[key] ?? '', alt: g.alt, summary: g.summary }));
  const review: Record<string, unknown> = { valid_as_of: d.review.valid_as_of, review_by: d.review.review_by };
  if (d.review.verified_against !== undefined) {
    review.verified_against = d.review.verified_against;
  }
  const ext: Record<string, unknown> = {
    'pack.knowledge_type_secondary': [...d.knowledge_type.secondary],
    'pack.stage_kind': d.stage2_kind, // contracts Ext regex ^pack\.[a-z_]+$ rejects digits → 'pack.stage2_kind' is not representable (escalation contract_change)
    'pack.review': review,
  };
  if (d.learning !== undefined) {
    ext['pack.learning'] = JSON.parse(JSON.stringify(d.learning)) as unknown;
  }
  out.push({
    kind: 'concept',
    sort: [d.id],
    file: c.rel,
    rec: {
      kind: 'concept',
      concept_id: d.id,
      track_id: d.track,
      level: d.level,
      knowledge_type: d.knowledge_type.primary,
      tier: d.tier,
      title_ko: d.title.ko,
      title_en: d.title.en,
      summary_ko: d.summary_ko,
      aliases: [...d.aliases],
      tags: [...d.tags],
      volatility: d.volatility,
      required_for_level: d.required_for_level,
      deprecated_by: d.deprecated_by,
      theory_md: sec('이론'),
      code_md: sec('코드'),
      core_md: sec('핵심'),
      diagrams,
      sources: d.sources.map(packSourceRef),
      ext,
    },
  });
  const edges = new Set<string>();
  const edge = (from: string, to: string, kind: string): void => {
    const k = `${from}\u0000${to}\u0000${kind}`;
    if (edges.has(k)) {
      return;
    }
    edges.add(k);
    out.push({
      kind: 'edge',
      sort: [from, to, kind],
      file: c.rel,
      rec: { kind: 'edge', from_concept_id: from, to_concept_id: to, edge_kind: kind, weight: 1 },
    });
  };
  for (const p of d.prereqs) {
    edge(p, d.id, 'prereq');
  }
  for (const s of Object.keys(d.siblings)) {
    edge(d.id, s, 'sibling');
  }
  for (const b of d.extends) {
    edge(b, d.id, 'extends');
  }
  for (const a of d.id_aliases) {
    out.push({
      kind: 'alias',
      sort: [a],
      file: c.rel,
      rec: { kind: 'alias', entity_kind: 'concept', alias_id: a, target_id: d.id },
    });
  }
  return out;
}

export type BuildPackInput = {
  readonly ctx: LintContext;
  readonly packId: string;
};

/** 팩 하나의 레코드 본문 + cap. */
export function buildBodies(input: BuildPackInput): PackBodies {
  const { ctx, packId } = input;
  const { model, idx } = ctx;
  const pack = model.packs.find((p) => p.data.id === packId);
  if (pack === undefined) {
    throw new Error(`invariant: pack ${packId} not found`);
  }
  const version = pack.data.version;
  const concepts = model.concepts.filter((c) => c.disc.track === packId).sort((a, b) => byCode(a.data.id, b.data.id));
  const entries: RecEntry[] = [];
  const subjects = new Map<string, string>();

  const inv = buildInventory(pack.data.id, concepts, idx, ctx.method);
  const cap = computeCap(ctx.mastery, inv);
  entries.push({
    kind: 'track',
    sort: [pack.data.track.id],
    file: pack.rel,
    rec: {
      kind: 'track',
      track_id: pack.data.track.id,
      name_ko: pack.data.track.name_ko,
      name_en: pack.data.track.name_en,
      track_group: pack.data.track.track_group,
      sort_order: pack.data.track.sort_order,
      offline_cap_level: cap.offline_cap_level,
      oracle_cap_level: cap.oracle_cap_level,
      summary_ko: pack.data.track.summary_ko,
      ext: {},
    },
  });

  const sourceIds = new Set<string>();
  const rubricIds = new Set<string>();
  for (const c of concepts) {
    for (const s of c.data.sources) {
      sourceIds.add(s.source_id);
    }
  }
  for (const f of model.kus.filter((x) => x.disc.track === packId)) {
    for (const ku of Object.values(f.data.kus)) {
      for (const s of ku.source_refs) {
        sourceIds.add(s.source_id);
      }
    }
  }
  for (const f of model.mcs.filter((x) => x.disc.track === packId)) {
    for (const mc of Object.values(f.data.mcs)) {
      for (const s of mc.source_refs) {
        sourceIds.add(s.source_id);
      }
    }
  }
  const itemFiles = model.items.filter((x) => x.disc.track === packId);
  for (const f of itemFiles) {
    for (const item of Object.values(f.data.items)) {
      for (const r of rubricIdsOfItem(item)) {
        rubricIds.add(r);
      }
    }
  }
  for (const id of [...sourceIds].sort(byCode)) {
    const e = sourceEntryRec(model, id);
    if (e !== null) {
      entries.push(e);
    }
  }
  for (const r of model.rubrics) {
    if (rubricIds.has(r.data.id) && (r.disc.common || r.disc.track === packId)) {
      entries.push(rubricEntry(r));
    }
  }
  for (const c of concepts) {
    entries.push(...conceptEntries(c));
  }
  for (const f of model.kus.filter((x) => x.disc.track === packId)) {
    const cid = f.data.concept_id;
    for (const [key, ku] of Object.entries(f.data.kus)) {
      entries.push({
        kind: 'ku',
        sort: [`${cid}.${key}`],
        file: f.rel,
        rec: {
          kind: 'ku',
          ku_id: `${cid}.${key}`,
          concept_id: cid,
          statement: ku.statement,
          facet: ku.facet,
          scope: ku.scope,
          vol: ku.vol,
          valid_as_of: ku.valid_as_of,
          deprecated_by: ku.deprecated_by === null ? null : `${cid}.${ku.deprecated_by}`,
          source_refs: ku.source_refs.map(packSourceRef),
          trust: 'authored',
          origin: 'authored',
          status: ku.deprecated_by === null ? 'published' : 'deprecated',
          ext: {
            'pack.type': ku.type,
            'pack.level_min': ku.level_min,
            'pack.bloom_affordance': [...ku.bloom_affordance],
            'pack.cloze_keys': [...ku.cloze_keys],
            'pack.accept': JSON.parse(JSON.stringify(ku.accept)) as unknown,
          },
        },
      });
    }
  }
  for (const f of model.mcs.filter((x) => x.disc.track === packId)) {
    const cid = f.data.concept_id;
    for (const [key, mc] of Object.entries(f.data.mcs)) {
      entries.push({
        kind: 'misconception',
        sort: [`${cid}.${key}`],
        file: f.rel,
        rec: {
          kind: 'misconception',
          mc_id: `${cid}.${key}`,
          concept_id: cid,
          statement: mc.wrong_belief,
          correction: mc.correction,
          meta_family: mc.meta_family,
          related_ku_ids: uniqSorted(mc.refutes.map((r) => `${cid}.${r}`)),
          status: 'active',
          ext: {
            'pack.kind': mc.kind,
            'pack.prevalence': mc.prevalence,
            'pack.source_refs': mc.source_refs.map(packSourceRef),
          },
        },
      });
    }
  }
  for (const f of model.itemModels.filter((x) => x.disc.track === packId)) {
    const cid = f.data.concept_id;
    for (const [key, m] of Object.entries(f.data.models)) {
      if (m.kind !== 't1') {
        continue; // t2 모델·템플릿 사본·T2 인스턴스 전개 = contracts/pack/t2-expand(CR-32) 부재로 건너뜀(report.validators.T2X skipped)
      }
      entries.push({
        kind: 'item_model',
        sort: [`${cid}.${key}`],
        file: f.rel,
        rec: {
          kind: 'item_model',
          model_id: `${cid}.${key}`,
          origin: 'pack',
          concept_id: cid,
          format: m.format,
          ku_ids: uniqSorted(m.ku_refs.map((r) => fullId(cid, r))),
          slots: { generator: m.generator, params: JSON.parse(JSON.stringify(m.params)) as unknown },
          constraints: {},
          metamorphic: {},
          stem_family: m.stem_family,
          status: 'active',
          author: 'seed',
          prompt_version: null,
          sample_gate: {},
          ext: {
            'pack.kind': m.kind,
            'pack.facet': m.facet,
            'pack.response_mode': m.response_mode,
            'pack.level': m.level,
            'pack.bloom': m.bloom,
          },
        },
      });
    }
  }
  const items: ItemBody[] = [];
  for (const f of itemFiles) {
    const concept = idx.conceptById.get(f.data.concept_id);
    if (concept === undefined) {
      continue;
    }
    for (const [key, item] of Object.entries(f.data.items)) {
      items.push(itemBody(f, key, item, concept, ctx, packId, version));
    }
  }
  items.sort((a, b) => byCode(a.itemId, b.itemId));
  for (const e of entries) {
    if (e.kind === 'concept' || e.kind === 'ku' || e.kind === 'misconception' || e.kind === 'item_model') {
      subjects.set(e.sort[0] ?? '', contentHash(e.rec));
    }
  }
  for (const it of items) {
    subjects.set(it.itemId, it.subject);
  }
  const offlineLearnable = inv.concepts.filter((c) => (c.formats_by_mode.OFFLINE ?? []).length > 0).length;
  return { packId, version, pack, concepts, entries, items, cap, offlineLearnable, subjects };
}

export type GateOutcome = {
  /** item_id → 문항 gate_status·s2_mode. */
  readonly status: ReadonlyMap<string, { readonly gate_status: string; readonly s2_mode: string | null }>;
  /** seed_reviewed 문항마다 GateResultRecord 본문(content_hash 자리는 호출 시 채운다). */
  readonly gateResults: readonly {
    readonly itemId: string;
    readonly batchId: string;
    readonly policy: string;
    readonly defectRate: number;
    readonly timeMs: number;
    readonly batchFile: string;
  }[];
};

function compareEntries(a: RecEntry, b: RecEntry): number {
  const ka = KIND_ORDER.indexOf(a.kind);
  const kb = KIND_ORDER.indexOf(b.kind);
  if (ka !== kb) {
    return ka - kb;
  }
  const n = Math.max(a.sort.length, b.sort.length);
  for (let i = 0; i < n; i += 1) {
    const c = byCode(a.sort[i] ?? '', b.sort[i] ?? '');
    if (c !== 0) {
      return c;
    }
  }
  return 0;
}

export type DetUlidFn = (timeMs: number, seed: string) => string;

/** content_hash를 붙이고 BundleRecord.parse(G0)로 검증한 정렬된 레코드 목록. */
export function finalizePack(bodies: PackBodies, gate: GateOutcome, ulid: DetUlidFn): PackRecords {
  const findings: Finding[] = [];
  const all: { entry: RecEntry; rec: Rec }[] = [];
  const itemHash = new Map<string, string>();
  for (const e of bodies.entries) {
    // edge·alias 레코드는 content_hash 필드가 없다(IF-01 pack/records.ts).
    const hashed = e.kind !== 'edge' && e.kind !== 'alias';
    all.push({ entry: e, rec: hashed ? { ...e.rec, content_hash: contentHash(e.rec) } : e.rec });
  }
  for (const it of bodies.items) {
    const st = gate.status.get(it.itemId) ?? { gate_status: it.deferred ? 'deferred' : 'authored', s2_mode: null };
    const full: Rec = { ...it.body, gate_status: st.gate_status, s2_mode: st.s2_mode };
    const hash = contentHash(full);
    itemHash.set(it.itemId, hash);
    all.push({
      entry: { kind: 'item', sort: [it.itemId], file: it.file, rec: full },
      rec: { ...full, content_hash: hash },
    });
  }
  for (const g of gate.gateResults) {
    const hash = itemHash.get(g.itemId) ?? '';
    const rec: Rec = {
      kind: 'gate_result',
      gate_result_id: ulid(g.timeMs, `${g.batchId}|${g.itemId}|${hash}`),
      subject_kind: 'item',
      subject_id: g.itemId,
      content_hash: hash,
      gate: 'V7',
      engine: 'USER',
      provider_id: null,
      run_context: 'seed_build',
      pass: true,
      score: null,
      probabilities: null,
      detail: { batch_id: g.batchId, policy: g.policy, defect_rate: g.defectRate },
    };
    all.push({ entry: { kind: 'gate_result', sort: [g.itemId], file: g.batchFile, rec }, rec });
  }
  all.sort((a, b) => compareEntries(a.entry, b.entry));
  const records: BundleRecordT[] = [];
  for (const { entry, rec } of all) {
    const parsed = BundleRecord.safeParse(rec);
    if (parsed.success) {
      records.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues) {
        findings.push(
          finding(
            'G0',
            'error',
            entry.file,
            `${entry.kind}:${entry.sort.join('/')}${issue.path.length === 0 ? '' : `.${issue.path.map(String).join('.')}`}`,
            issue.message,
          ),
        );
      }
    }
  }
  return { records, findings };
}
