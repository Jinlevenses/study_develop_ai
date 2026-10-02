// R-ID(+R-NS·R-FILE·R-ID-SLUG 흡수) — ID 형식·네임스페이스·파일 이름·전역 유일·파생 ID·루브릭/템플릿/출처/V7 이름 규칙.
import { ConceptId, ItemId, ItemModelId, KuId, MisconceptionId } from '@fathom/contracts/common/ids';
import type { Finding } from '../../validate/finding.js';
import { finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

const RESERVED_SLUGS: ReadonlySet<string> = new Set(['case', 'art', 'lab']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ruleId(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  const { model, idx } = ctx;
  const err = (file: string, keypath: string, message: string) =>
    out.push(finding('R-ID', 'error', file, keypath, message));

  // 개념 파일
  const firstById = new Map<string, string>();
  const aliasOwner = new Map<string, string>();
  for (const c of model.concepts) {
    const rel = c.rel;
    const id = c.data.id;
    const name = c.disc.name;
    const track = c.disc.track ?? '';
    if (!ConceptId.safeParse(name).success) {
      err(rel, '', `file name '${name}' is not a valid concept id`);
    }
    if (id.split('.')[0] !== track) {
      err(rel, 'id', `id '${id}' must start with the pack directory '${track}.' (R-NS)`);
    }
    if (c.data.track !== track) {
      err(rel, 'track', `track '${c.data.track}' must equal the pack directory '${track}' (R-NS)`);
    }
    if (name !== id) {
      err(rel, 'id', `id '${id}' must equal the file name '${name}' (R-FILE)`);
    }
    const slug = id.slice(id.indexOf('.') + 1);
    if (RESERVED_SLUGS.has(slug)) {
      err(rel, 'id', `slug '${slug}' is reserved (R-ID-SLUG)`);
    }
    const first = firstById.get(id);
    if (first === undefined) {
      firstById.set(id, rel);
    } else {
      err(rel, 'id', `id '${id}' is already defined in ${first} (global uniqueness)`);
    }
  }
  for (const c of model.concepts) {
    for (const [i, a] of c.data.id_aliases.entries()) {
      if (a === c.data.id) {
        err(c.rel, `id_aliases.${i}`, `alias '${a}' equals the current id`);
      } else if (idx.conceptById.has(a)) {
        err(c.rel, `id_aliases.${i}`, `alias '${a}' collides with a current concept id`);
      }
      const owner = aliasOwner.get(a);
      if (owner === undefined) {
        aliasOwner.set(a, c.rel);
      } else if (owner !== c.rel) {
        err(c.rel, `id_aliases.${i}`, `alias '${a}' is already an alias in ${owner}`);
      }
    }
  }

  // 개념에 딸린 파일(kus·misconceptions·items·item-models)
  const hasConcept = (track: string | null, cid: string): boolean => {
    const c = idx.conceptById.get(cid);
    return c !== undefined && c.disc.track === track;
  };
  const attached = [
    ...model.kus.map((f) => ({ f, what: 'kus', keys: Object.keys(f.data.kus), schema: KuId })),
    ...model.mcs.map((f) => ({ f, what: 'mcs', keys: Object.keys(f.data.mcs), schema: MisconceptionId })),
    ...model.items.map((f) => ({ f, what: 'items', keys: Object.keys(f.data.items), schema: ItemId })),
    ...model.itemModels.map((f) => ({ f, what: 'models', keys: Object.keys(f.data.models), schema: ItemModelId })),
  ];
  for (const { f, what, keys, schema } of attached) {
    const cid = f.data.concept_id;
    if (f.disc.name !== cid) {
      err(f.rel, 'concept_id', `concept_id '${cid}' must equal the file name '${f.disc.name}' (R-FILE)`);
    }
    if (!hasConcept(f.disc.track, cid)) {
      err(f.rel, 'concept_id', `orphan file: no concept '${cid}' in pack '${f.disc.track ?? ''}' (R-FILE)`);
    }
    for (const key of keys) {
      const derived = `${cid}.${key}`;
      if (!schema.safeParse(derived).success) {
        err(f.rel, `${what}.${key}`, `derived id '${derived}' is not a valid ${what} id`);
      }
    }
  }

  // 루브릭 · 템플릿
  for (const r of model.rubrics) {
    if (r.data.id !== `rb.${r.disc.name}`) {
      err(r.rel, 'id', `rubric id '${r.data.id}' must equal 'rb.${r.disc.name}'`);
    }
    if (!r.disc.common && idx.commonRubricIds.has(r.data.id)) {
      err(r.rel, 'id', `pack rubric id '${r.data.id}' collides with a shared rubric`);
    }
  }
  for (const t of [...model.t2, ...model.dig]) {
    if (t.data.id !== t.disc.name) {
      err(t.rel, 'id', `template id '${t.data.id}' must equal the file name '${t.disc.name}'`);
    }
  }

  // 출처
  const registryIds = new Set<string>();
  for (const r of model.registries) {
    for (const id of Object.keys(r.data.sources)) {
      registryIds.add(id);
    }
  }
  const requestSeen = new Map<string, string>();
  for (const r of [...model.requests].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    for (const [id, entry] of Object.entries(r.data.requests)) {
      if (!entry.merged && registryIds.has(id)) {
        err(r.rel, `requests.${id}`, `source '${id}' is already in the registry but the request is not merged`);
      }
      const first = requestSeen.get(id);
      if (first === undefined) {
        requestSeen.set(id, r.rel);
      } else {
        err(r.rel, `requests.${id}`, `source '${id}' is already requested in ${first}`);
      }
    }
  }

  // V7 배치 이름
  for (const v of model.v7) {
    if (v.disc.name !== v.data.batch_id) {
      err(v.rel, 'batch_id', `batch_id '${v.data.batch_id}' must equal the file name '${v.disc.name}'`);
    }
    if (v.disc.packDir !== v.data.pack_id) {
      err(v.rel, 'pack_id', `pack_id '${v.data.pack_id}' must equal the directory '${v.disc.packDir ?? ''}'`);
    }
    if (!new RegExp(`^v7\\.${escapeRe(v.data.pack_id)}\\.\\d{3}$`).test(v.data.batch_id)) {
      err(v.rel, 'batch_id', `batch_id '${v.data.batch_id}' must match v7.<pack_id>.NNN`);
    }
  }
  return out;
}
