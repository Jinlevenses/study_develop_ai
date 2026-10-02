// V1을 통과한 파일로 만든 ContentModel(Brief T-01-03 §4.4) — V2 lint·V7 바인딩·emit·inventory가 같은 모델을 읽는다.
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import type { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import type { z } from 'zod';
import type { DiscoveredFile } from '../parse/discover.js';
import type { ParsedBody } from '../parse/markdown.js';
import type { ConceptFrontmatter } from '../parse/schema/concept.js';
import type { ItemFile } from '../parse/schema/item.js';
import type { ItemModelFile } from '../parse/schema/item-model.js';
import type { KuFile } from '../parse/schema/ku.js';
import type { McFile } from '../parse/schema/misconception.js';
import type { PackYaml } from '../parse/schema/pack.js';
import type { RubricFile } from '../parse/schema/rubric.js';
import type { SourceRegistry } from '../parse/schema/source.js';
import type { SourceRequestFile, TemplateDigFile, TemplateT2File } from '../parse/schema/template.js';
import type { V7Record } from '../parse/schema/v7.js';

export type FileMeta = { readonly rel: string; readonly disc: DiscoveredFile };

export type LoadedFile =
  | (FileMeta & { readonly kind: 'pack'; readonly data: PackYaml })
  | (FileMeta & { readonly kind: 'concept'; readonly data: ConceptFrontmatter; readonly body: ParsedBody })
  | (FileMeta & { readonly kind: 'kus'; readonly data: KuFile })
  | (FileMeta & { readonly kind: 'misconceptions'; readonly data: McFile })
  | (FileMeta & { readonly kind: 'items'; readonly data: ItemFile })
  | (FileMeta & { readonly kind: 'item-models'; readonly data: ItemModelFile })
  | (FileMeta & { readonly kind: 'rubrics'; readonly data: RubricFile })
  | (FileMeta & { readonly kind: 'templates-t2'; readonly data: TemplateT2File })
  | (FileMeta & { readonly kind: 'templates-dig'; readonly data: TemplateDigFile })
  | (FileMeta & { readonly kind: 'sources-registry'; readonly data: SourceRegistry })
  | (FileMeta & { readonly kind: 'sources-requests'; readonly data: SourceRequestFile })
  | (FileMeta & { readonly kind: 'review-v7'; readonly data: V7Record });

type Of<K extends LoadedFile['kind']> = Extract<LoadedFile, { kind: K }>;

export type PackFile = Of<'pack'>;
export type ConceptFile = Of<'concept'>;
export type KuFileEntry = Of<'kus'>;
export type McFileEntry = Of<'misconceptions'>;
export type ItemFileEntry = Of<'items'>;
export type ItemModelFileEntry = Of<'item-models'>;
export type RubricFileEntry = Of<'rubrics'>;
export type TemplateT2Entry = Of<'templates-t2'>;
export type TemplateDigEntry = Of<'templates-dig'>;
export type RegistryEntry = Of<'sources-registry'>;
export type RequestEntry = Of<'sources-requests'>;
export type V7Entry = Of<'review-v7'>;

export type ContentModel = {
  readonly packs: readonly PackFile[];
  readonly concepts: readonly ConceptFile[];
  readonly kus: readonly KuFileEntry[];
  readonly mcs: readonly McFileEntry[];
  readonly items: readonly ItemFileEntry[];
  readonly itemModels: readonly ItemModelFileEntry[];
  readonly rubrics: readonly RubricFileEntry[];
  readonly t2: readonly TemplateT2Entry[];
  readonly dig: readonly TemplateDigEntry[];
  readonly registries: readonly RegistryEntry[];
  readonly requests: readonly RequestEntry[];
  readonly v7: readonly V7Entry[];
};

export function buildModel(files: readonly LoadedFile[]): ContentModel {
  const packs: PackFile[] = [];
  const concepts: ConceptFile[] = [];
  const kus: KuFileEntry[] = [];
  const mcs: McFileEntry[] = [];
  const items: ItemFileEntry[] = [];
  const itemModels: ItemModelFileEntry[] = [];
  const rubrics: RubricFileEntry[] = [];
  const t2: TemplateT2Entry[] = [];
  const dig: TemplateDigEntry[] = [];
  const registries: RegistryEntry[] = [];
  const requests: RequestEntry[] = [];
  const v7: V7Entry[] = [];
  for (const f of files) {
    switch (f.kind) {
      case 'pack':
        packs.push(f);
        break;
      case 'concept':
        concepts.push(f);
        break;
      case 'kus':
        kus.push(f);
        break;
      case 'misconceptions':
        mcs.push(f);
        break;
      case 'items':
        items.push(f);
        break;
      case 'item-models':
        itemModels.push(f);
        break;
      case 'rubrics':
        rubrics.push(f);
        break;
      case 'templates-t2':
        t2.push(f);
        break;
      case 'templates-dig':
        dig.push(f);
        break;
      case 'sources-registry':
        registries.push(f);
        break;
      case 'sources-requests':
        requests.push(f);
        break;
      case 'review-v7':
        v7.push(f);
        break;
      default:
        break;
    }
  }
  return { packs, concepts, kus, mcs, items, itemModels, rubrics, t2, dig, registries, requests, v7 };
}

/** 참조 해석용 색인. 개념·KU·MC·문항 ID는 파일 안에 선언된 concept_id 기준(파일 이름과 다르면 R-ID가 보고). */
export type Indexes = {
  readonly conceptById: ReadonlyMap<string, ConceptFile>;
  readonly kuIds: ReadonlySet<string>;
  readonly mcIds: ReadonlySet<string>;
  readonly itemFormatById: ReadonlyMap<string, string>;
  readonly kusByConcept: ReadonlyMap<string, KuFileEntry>;
  readonly mcsByConcept: ReadonlyMap<string, McFileEntry>;
  readonly itemsByConcept: ReadonlyMap<string, ItemFileEntry>;
  readonly modelsByConcept: ReadonlyMap<string, ItemModelFileEntry>;
  readonly commonRubricIds: ReadonlySet<string>;
  readonly packRubricIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** 레지스트리 ∪ 요청 파일의 출처 id. */
  readonly sourceIds: ReadonlySet<string>;
};

export function buildIndexes(model: ContentModel): Indexes {
  const conceptById = new Map<string, ConceptFile>();
  for (const c of model.concepts) {
    if (!conceptById.has(c.data.id)) {
      conceptById.set(c.data.id, c);
    }
  }
  const kusByConcept = new Map<string, KuFileEntry>();
  const kuIds = new Set<string>();
  for (const k of model.kus) {
    if (!kusByConcept.has(k.data.concept_id)) {
      kusByConcept.set(k.data.concept_id, k);
    }
    for (const key of Object.keys(k.data.kus)) {
      kuIds.add(`${k.data.concept_id}.${key}`);
    }
  }
  const mcsByConcept = new Map<string, McFileEntry>();
  const mcIds = new Set<string>();
  for (const m of model.mcs) {
    if (!mcsByConcept.has(m.data.concept_id)) {
      mcsByConcept.set(m.data.concept_id, m);
    }
    for (const key of Object.keys(m.data.mcs)) {
      mcIds.add(`${m.data.concept_id}.${key}`);
    }
  }
  const itemsByConcept = new Map<string, ItemFileEntry>();
  const itemFormatById = new Map<string, string>();
  for (const i of model.items) {
    if (!itemsByConcept.has(i.data.concept_id)) {
      itemsByConcept.set(i.data.concept_id, i);
    }
    for (const [key, item] of Object.entries(i.data.items)) {
      itemFormatById.set(`${i.data.concept_id}.${key}`, item.format);
    }
  }
  const modelsByConcept = new Map<string, ItemModelFileEntry>();
  for (const m of model.itemModels) {
    if (!modelsByConcept.has(m.data.concept_id)) {
      modelsByConcept.set(m.data.concept_id, m);
    }
  }
  const commonRubricIds = new Set<string>();
  const packRubric = new Map<string, Set<string>>();
  for (const r of model.rubrics) {
    if (r.disc.common) {
      commonRubricIds.add(r.data.id);
    } else {
      const track = r.disc.track ?? '';
      const set = packRubric.get(track) ?? new Set<string>();
      set.add(r.data.id);
      packRubric.set(track, set);
    }
  }
  const sourceIds = new Set<string>();
  for (const r of model.registries) {
    for (const id of Object.keys(r.data.sources)) {
      sourceIds.add(id);
    }
  }
  for (const r of model.requests) {
    for (const id of Object.keys(r.data.requests)) {
      sourceIds.add(id);
    }
  }
  return {
    conceptById,
    kuIds,
    mcIds,
    itemFormatById,
    kusByConcept,
    mcsByConcept,
    itemsByConcept,
    modelsByConcept,
    commonRubricIds,
    packRubricIds: packRubric,
    sourceIds,
  };
}

/** 로컬 키('k03'·'m01') → 전체 ID, 이미 전체 ID면 그대로. */
export function fullId(conceptId: string, ref: string): string {
  return /^[km]\d{2}$/.test(ref) ? `${conceptId}.${ref}` : ref;
}

/** V2 규칙이 받는 입력. */
export type LintContext = {
  readonly model: ContentModel;
  readonly idx: Indexes;
  readonly mastery: z.infer<typeof MasteryRulesV1>;
  readonly method: z.infer<typeof MethodPolicyV1>;
  readonly release: boolean;
};
