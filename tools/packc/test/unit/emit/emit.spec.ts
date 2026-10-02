// UT-PACKC-003·065~079 — emit: 레코드 매핑 · 해시 · 정렬 · merkle · manifest · tar · report · cap · 출력.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FormatId } from '@fathom/contracts/common/domain';
import { Ulid } from '@fathom/contracts/common/ids';
import { FpackManifest } from '@fathom/contracts/pack/manifest';
import { BundleRecord } from '@fathom/contracts/pack/records';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackBuild } from '../../../src/emit/build.js';
import { buildPack, LAYOUT_JSON, prepare, writeFpack } from '../../../src/emit/build.js';
import { dayToEpochMs, detUlid } from '../../../src/emit/det-ulid.js';
import { contentHash, subjectHash } from '../../../src/emit/hash.js';
import { PACKC_VERSION } from '../../../src/emit/manifest.js';
import { merkleRoot } from '../../../src/emit/merkle.js';
import { finalizePack } from '../../../src/emit/records.js';
import { PackReport } from '../../../src/emit/report.js';
import { buildTar } from '../../../src/emit/tar.js';
import { buildInventory, computeCap } from '../../../src/lint/inventory.js';
import { runCheck } from '../../../src/lint/run.js';
import type { Mutation } from '../cli/helpers.js';
import { FIXTURES, mutatedTree, REPO_POLICY, rmTmp } from '../cli/helpers.js';
import { EXTRA_ITEMS_YAML } from './extra-items.js';
import { readTar } from './tar-reader.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});

const base = (rel: string): string => readFileSync(join(FIXTURES, 'base/content', rel), 'utf8');
const DITEMS = 'content/packs/docker/items/docker.dockerfile.yaml';
const KITEMS = 'content/packs/k8s/items/k8s.probes.yaml';

function build(m: Mutation = {}, packId = 'docker'): PackBuild {
  const { root, contentDir } = mutatedTree(m);
  roots.push(root);
  const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release: false });
  if (!r.ok) {
    throw new Error(r.error);
  }
  const errors = r.value.findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `fixture has errors: ${errors.map((f) => `${f.rule} ${f.file} ${f.keypath} ${f.message}`).join(' | ')}`,
    );
  }
  return buildPack({ ctx: r.value.ctx, packId, v2Warnings: 0 });
}

type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function rec(v: unknown): Rec {
  if (!isRec(v)) {
    throw new Error('expected an object');
  }
  return v;
}
function of(b: PackBuild, kind: string): Rec[] {
  return b.records.records.filter((r) => r.kind === kind).map((r) => rec(r));
}
function one(b: PackBuild, kind: string, key: string, id: string): Rec {
  const found = of(b, kind).find((r) => r[key] === id);
  if (found === undefined) {
    throw new Error(`no ${kind} ${id}`);
  }
  return found;
}

/** base items yaml에 22형식을 채우는 변형. */
const WITH_ALL_FORMATS: Mutation = { append: { [DITEMS]: EXTRA_ITEMS_YAML } };

/** 블록(`  iNN:`) 순서를 뒤집은 yaml. */
function reverseBlocks(text: string, marker: RegExp): string {
  const parts = text.split(marker);
  const head = parts.shift() ?? '';
  const heads = [...text.matchAll(marker)].map((m) => m[0]);
  const blocks = parts.map((p, i) => `${heads[i] ?? ''}${p}`).reverse();
  return head + blocks.join('');
}

describe('UT-PACKC-003 determinism [FR-CUR-002]', () => {
  it('UT-PACKC-003 building twice gives the same merkle_root and the same .fpack bytes [FR-CUR-002]', () => {
    const a = build();
    const b = build();
    expect(a.fpack).not.toBeNull();
    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.fpack?.equals(b.fpack ?? Buffer.alloc(0))).toBe(true);
  });

  it('UT-PACKC-003 reordering files and keys keeps the merkle_root; changing one item changes it [FR-CUR-002]', () => {
    const k8s = build({}, 'k8s');
    const reordered = build(
      {
        write: {
          [KITEMS]: reverseBlocks(base('packs/k8s/items/k8s.probes.yaml'), /^ {2}i\d\d:\n/gm),
          'content/packs/k8s/kus/k8s.probes.yaml': reverseBlocks(
            base('packs/k8s/kus/k8s.probes.yaml'),
            /^ {2}k\d\d:\n/gm,
          ),
        },
      },
      'k8s',
    );
    expect(reordered.merkleRoot).toBe(k8s.merkleRoot);
    expect(reordered.fpack?.equals(k8s.fpack ?? Buffer.alloc(0))).toBe(true);
    const changed = build(
      {
        replace: [
          {
            file: KITEMS,
            from: '프로브는 kubelet이 컨테이너 상태를 주기적으로 검사하는 장치다.',
            to: '프로브는 kubelet이 컨테이너 상태를 주기적으로 점검하는 장치다.',
          },
        ],
      },
      'k8s',
    );
    expect(changed.merkleRoot).not.toBe(k8s.merkleRoot);
  });
});

describe('UT-PACKC-065 track, source, rubric records [FR-CUR-002][FR-CUR-009]', () => {
  it('UT-PACKC-065 the track record carries pack.yaml fields and the computed caps [FR-CUR-002]', () => {
    const b = build();
    const t = one(b, 'track', 'track_id', 'docker');
    expect(t).toMatchObject({
      name_ko: '컨테이너',
      name_en: 'Containers (Docker/OCI)',
      track_group: 'infra',
      sort_order: 9,
      ext: {},
    });
    expect(t.offline_cap_level).toBe(b.bodies.cap.offline_cap_level);
    expect(t.oracle_cap_level).toBe(b.bodies.cap.oracle_cap_level);
  });

  it('UT-PACKC-065 only the sources the pack references are emitted, with license details in ext [FR-CUR-012]', () => {
    const d = build();
    expect(of(d, 'source').map((s) => s.source_id)).toEqual(['src.docker-docs']);
    const s = of(d, 'source')[0] ?? {};
    expect(s).toMatchObject({
      source_type: 'doc',
      url: 'https://docs.docker.com',
      ref_text: null,
      license_grade: 'A',
      fetched_at: null,
    });
    expect(rec(s.ext)['pack.license']).toMatchObject({ spdx: 'Apache-2.0', grade: 'A' });
    expect(rec(s.ext)['pack.publisher']).toBe('Docker Inc.');
    expect(rec(s.ext)['pack.primary']).toBe(true);
    expect(rec(s.ext)['pack.code_license']).toBeUndefined();
    const k = build({}, 'k8s');
    expect(of(k, 'source').map((x) => x.source_id)).toEqual(['src.k8s-docs']);
    expect(rec(rec(of(k, 'source')[0]).ext)['pack.code_license']).toEqual({ spdx: 'Apache-2.0', grade: 'A' });
  });

  it('UT-PACKC-065 only the rubrics the pack items reference are emitted, weights normalised [FR-CUR-009]', () => {
    const d = build();
    expect(of(d, 'rubric').map((r) => r.rubric_id)).toEqual(['rb.explain-generic', 'rb.feynman-teach', 'rb.solo-5']);
    const solo = one(d, 'rubric', 'rubric_id', 'rb.solo-5');
    const dims = rec(rec(solo.dims).dims);
    const total = Object.values(dims).reduce<number>((s, x) => s + Number(rec(x).weight), 0);
    expect(total).toBeCloseTo(1, 12);
    expect(rec(dims.d_accuracy).weight).toBeCloseTo(1.5 / 3.5, 12);
    expect(rec(rec(dims.d_accuracy).levels)).toHaveProperty('l4');
    expect(rec(solo.ext)['pack.raw_weights']).toEqual({ d_accuracy: 1.5, d_coverage: 1, d_structure: 1 });
    expect(rec(solo.ext)['pack.pass_mean']).toBe(2.5);
    expect(of(build({}, 'k8s'), 'rubric')).toEqual([]);
  });
});

describe('UT-PACKC-066 concept, edge, alias records [FR-CUR-002]', () => {
  it('UT-PACKC-066 concept sections, diagrams, sources and ext follow DCP-01 section 5.3 [FR-CUR-002]', () => {
    const b = build();
    const c = one(b, 'concept', 'concept_id', 'docker.dockerfile');
    expect(c).toMatchObject({
      track_id: 'docker',
      level: 1,
      knowledge_type: 'P',
      tier: 'A',
      title_ko: 'Dockerfile 작성',
      required_for_level: 1,
      deprecated_by: null,
    });
    expect(String(c.theory_md).startsWith('### 왜 필요한가')).toBe(true);
    expect(String(c.theory_md)).toContain('```mermaid dg_build_flow');
    expect(String(c.code_md).startsWith('### Worked example')).toBe(true);
    expect(String(c.core_md).endsWith('::ku-list')).toBe(true);
    const dg = rec(rec(c.diagrams).dg_build_flow);
    expect(String(dg.mermaid).startsWith('flowchart TB')).toBe(true);
    expect(dg.alt).toContain('Dockerfile');
    const src = rec((c.sources as unknown[])[0]);
    expect(src).toMatchObject({
      source_id: 'src.docker-docs',
      usage: 'paraphrase',
      product_version: null,
      quote: null,
    });
    const ext = rec(c.ext);
    expect(ext['pack.knowledge_type_secondary']).toEqual(['C']);
    expect(ext['pack.stage_kind']).toBe('code');
    expect(rec(ext['pack.review']).valid_as_of).toBe('2026-10-01');
    expect(rec(ext['pack.learning']).mnemonic).toBe('RUN은 굽는다(빌드), CMD는 켠다(실행)');
    const c2 = one(b, 'concept', 'concept_id', 'docker.image-layer');
    expect(rec(c2.ext)['pack.learning']).toBeUndefined();
    expect(c2.code_md).toBe('::needs-enrichment');
  });

  it('UT-PACKC-066 prereq, sibling and extends edges and id aliases; edge and alias have no content_hash [FR-CUR-002]', () => {
    const b = build({
      replace: [
        {
          file: 'content/packs/docker/concepts/docker.dockerfile.md',
          from: 'extends: []\n',
          to: 'extends: [docker.image-security]\n',
        },
        {
          file: 'content/packs/docker/concepts/docker.dockerfile.md',
          from: 'id_aliases: []',
          to: 'id_aliases: [docker.old-dockerfile]',
        },
      ],
    });
    const edges = of(b, 'edge').map((e) => `${e.from_concept_id}>${e.to_concept_id}:${e.edge_kind}`);
    expect(edges).toContain('docker.image-layer>docker.dockerfile:prereq');
    expect(edges).toContain('docker.dockerfile>docker.run-lifecycle:sibling');
    expect(edges).toContain('docker.image-security>docker.dockerfile:extends');
    expect(of(b, 'edge').every((e) => e.weight === 1 && e.content_hash === undefined)).toBe(true);
    expect(of(b, 'alias')).toEqual([
      { kind: 'alias', entity_kind: 'concept', alias_id: 'docker.old-dockerfile', target_id: 'docker.dockerfile' },
    ]);
    const k = build({}, 'k8s');
    expect(of(k, 'edge').map((e) => `${e.from_concept_id}>${e.to_concept_id}`)).toEqual([
      'docker.dockerfile>k8s.pod',
      'k8s.pod>k8s.probes',
    ]);
  });
});

describe('UT-PACKC-067 ku and misconception records [FR-CUR-002]', () => {
  it('UT-PACKC-067 ku ids, statuses and ext; misconceptions relate to full ku ids [FR-CUR-002]', () => {
    const b = build();
    expect(of(b, 'ku')).toHaveLength(10);
    const k = one(b, 'ku', 'ku_id', 'docker.dockerfile.k03');
    expect(k).toMatchObject({
      concept_id: 'docker.dockerfile',
      facet: 'contrast',
      trust: 'authored',
      origin: 'authored',
      status: 'published',
      deprecated_by: null,
      valid_as_of: '2026-10-01',
    });
    expect(rec(k.ext)['pack.type']).toBe('comparison');
    expect(rec(k.ext)['pack.level_min']).toBe(1);
    expect(rec(k.ext)['pack.cloze_keys']).toEqual(['빌드하는 동안', '시작될 때']);
    const dep = build({
      replace: [
        {
          file: 'content/packs/docker/kus/docker.dockerfile.yaml',
          from: '    level_min: 1\n    bloom_affordance: [remember, understand]\n    cloze_keys: ["위에서 아래"]',
          to: '    level_min: 1\n    deprecated_by: k02\n    bloom_affordance: [remember, understand]\n    cloze_keys: ["위에서 아래"]',
        },
      ],
    });
    expect(one(dep, 'ku', 'ku_id', 'docker.dockerfile.k01')).toMatchObject({
      status: 'deprecated',
      deprecated_by: 'docker.dockerfile.k02',
    });
    const m = one(b, 'misconception', 'mc_id', 'docker.dockerfile.m02');
    expect(m).toMatchObject({
      concept_id: 'docker.dockerfile',
      status: 'active',
      meta_family: 'mf_cost_blindness',
      related_ku_ids: ['docker.dockerfile.k01', 'docker.dockerfile.k08'],
    });
    expect(String(m.statement)).toContain('명령 순서');
    expect(rec(m.ext)['pack.kind']).toBe('mechanism_confusion');
    expect(rec(m.ext)['pack.prevalence']).toBe('high');
    expect(rec(m.ext)['pack.source_refs']).toEqual([]);
  });
});

describe('UT-PACKC-068 item mapping for the 22 item formats [FR-CUR-002][FR-CUR-009]', () => {
  const b = build(WITH_ALL_FORMATS);
  const item = (n: number): Rec => one(b, 'item', 'item_id', `docker.dockerfile.i${String(n).padStart(2, '0')}`);

  it('UT-PACKC-068 all 22 formats are present and parse as ItemRecord [FR-CUR-002]', () => {
    const formats = new Set(of(b, 'item').map((i) => i.format));
    expect(formats.size).toBe(22);
    for (const i of of(b, 'item')) {
      expect(BundleRecord.safeParse(i).success, String(i.item_id)).toBe(true);
    }
  });

  it('UT-PACKC-068 common fields: family, ids, tier, n_options, beta_prior, snapshot [FR-CUR-002]', () => {
    const i = item(5);
    expect(i).toMatchObject({
      origin: 'pack',
      model_id: null,
      family_id: 'seed:docker@0',
      lab_id: null,
      source_kind: 'seed',
      beta_prior: 0,
      tier: 'A',
      lineage: {},
    });
    expect(i.n_options).toBe(Object.keys(rec(i.options)).length);
    expect(rec(rec(i.snapshot).kus)).toHaveProperty(String((i.ku_ids as string[])[0]));
    expect(i.ku_ids).toEqual([...(i.ku_ids as string[])].sort());
    expect(rec(i.ext)['pack.roles']).toBeDefined();
    expect(rec(i.ext)['pack.tags']).toBeDefined();
    expect(Object.keys(rec(item(1).ext))).toEqual(expect.arrayContaining(['pack.roles', 'pack.tags']));
  });

  it('UT-PACKC-068 ox, mcq, mcq_multi, cloze, short [FR-CUR-002]', () => {
    const ox = item(1);
    expect(ox.format).toBe('ox');
    expect(ox.n_options).toBe(2);
    expect(ox.options).toEqual({});
    expect(rec(ox.stem)).toHaveProperty('md');
    expect(Object.keys(rec(ox.answer_key)).sort()).toEqual(['answer', 'correction_md', 'false_mc']);
    const mcq = item(5);
    expect(rec(mcq.stem)).toHaveProperty('code');
    expect(Object.keys(rec(mcq.options)).every((k) => k.startsWith('opt_'))).toBe(true);
    expect(rec(mcq.answer_key)).toHaveProperty('option_rationale');
    expect(Object.values(rec(mcq.distractor_mc)).every((v) => String(v).startsWith('docker.dockerfile.m'))).toBe(true);
    expect(rec(item(23).answer_key)).toEqual({ answer: ['opt_a', 'opt_c'] });
    const cloze = item(8);
    expect(rec(cloze.stem).md).toContain('{{b1}}');
    expect(rec(rec(cloze.answer_key).blanks).b1).toMatchObject({
      normalize: { nfkc: true, case: 'insensitive', space: 'collapse', strip_josa: true },
    });
    expect(Object.keys(rec(item(9).answer_key)).sort()).toEqual(['accept', 'accept_regex', 'normalize', 'numeric']);
  });

  it('UT-PACKC-068 order, matching, code_predict, error_find, parsons, config_review, log_read [FR-CUR-002]', () => {
    expect(rec(item(24).options)).toHaveProperty('s_from');
    expect(rec(item(24).answer_key).answer).toEqual(['s_from', 's_dir', 's_copy', 's_cmd']);
    expect(rec(item(25).options)).toEqual({
      l_run: { side: 'left', md: 'RUN' },
      l_cmd: { side: 'left', md: 'CMD' },
      r_build: { side: 'right', md: '빌드할 때 한 번' },
      r_start: { side: 'right', md: '컨테이너가 시작될 때' },
    });
    expect(rec(item(25).answer_key)).toEqual({ answer: { l_run: 'r_build', l_cmd: 'r_start' } });
    expect(rec(item(26).stem)).toMatchObject({ code: { lang: 'js' } });
    expect(item(26).answer_key).toEqual({ stdout: 'RUN CMD' });
    expect(Object.keys(rec(item(10).answer_key)).sort()).toEqual(['bug_mc', 'from', 'to']);
    expect(rec(item(27).stem)).toMatchObject({ lang: 'dockerfile', indent: false });
    expect(rec(item(27).options)).toHaveProperty('ln_a');
    expect(item(27).answer_key).toEqual({ answer: ['ln_a', 'ln_b', 'ln_c'], distractors: ['ln_d'] });
    const cfg = item(11);
    expect(cfg.answer_key).toEqual({});
    expect(rec(cfg.stem)).toHaveProperty('artifact');
    expect(cfg.defect_manifest).not.toBeNull();
    expect(rec(item(28).stem)).toHaveProperty('log');
    expect(item(28).answer_key).toEqual({ answer: 'opt_a' });
    expect(rec(item(28).distractor_mc)).toEqual({ opt_b: 'docker.dockerfile.m04' });
  });

  it('UT-PACKC-068 cond_reversal, fermi, blank_note, essay, digging, d4, feynman, audit, pr_review, embedded [FR-CUR-002]', () => {
    expect(rec(item(29).stem)).toMatchObject({
      conditions: { cond_a: expect.any(String), cond_b: expect.any(String) },
    });
    expect(rec(item(29).answer_key)).toMatchObject({ answer: { cond_a: 'opt_a', cond_b: 'opt_b' } });
    expect(item(30).answer_key).toEqual({ value: 480, unit: 'MB', log10_tol: 0.3, assumptions_rubric: null });
    const bn = rec(item(12).answer_key);
    expect(Object.keys(bn).sort()).toEqual(['idea_units', 'model_note_md', 'solo_rubric']);
    expect(Object.values(rec(bn.idea_units)).every((u) => String(rec(u).ku_id).startsWith('docker.dockerfile.k'))).toBe(
      true,
    );
    const essay = rec(item(22).answer_key);
    expect(essay.rubric).toBe('rb.explain-generic');
    expect(Object.keys(essay).sort()).toEqual(['key_points', 'model_answer_md', 'rubric']);
    expect(rec(item(14).stem)).toMatchObject({ depth: 'd1' });
    expect(Object.keys(rec(item(14).answer_key)).sort()).toEqual(['expects', 'followups']);
    expect(rec(item(19).stem)).toMatchObject({ depth: expect.stringMatching(/^d[45]$/) });
    expect(rec(item(19).answer_key)).toHaveProperty('answer');
    const fey = item(21);
    expect(
      rec(rec(fey.stem).student_beliefs).sb_run_cmd ?? Object.values(rec(rec(fey.stem).student_beliefs))[0],
    ).toHaveProperty('mc_id');
    expect(Object.keys(rec(fey.answer_key)).sort()).toEqual(['checklist', 'rubric']);
    expect(rec(item(31).stem)).toHaveProperty('artifact_md');
    expect(rec(rec(item(31).defect_manifest).df_order).mc_ref).toBe('docker.dockerfile.m02');
    expect(rec(item(32).stem)).toHaveProperty('diff');
    expect(item(32).answer_key).toEqual({});
    const emb = item(13);
    expect(rec(emb.stem)).toMatchObject({ shape: expect.stringMatching(/^(ox|mcq)$/) });
    expect(Object.keys(rec(emb.answer_key)).sort()).toEqual(['answer', 'false_mc']);
  });

  it('UT-PACKC-068 defect manifests exist only for config_review, audit and pr_review [FR-CUR-002]', () => {
    for (const i of of(b, 'item')) {
      const manifest = ['config_review', 'audit', 'pr_review'].includes(String(i.format));
      expect(i.defect_manifest !== null, String(i.item_id)).toBe(manifest);
    }
  });
});

describe('UT-PACKC-069 item_model records [FR-CUR-009]', () => {
  it('UT-PACKC-069 t1 bindings become item_model records with slots {generator, params} [FR-CUR-009]', () => {
    const b = build();
    const m = one(b, 'item_model', 'model_id', 'docker.dockerfile.im01');
    expect(m).toMatchObject({
      origin: 'pack',
      concept_id: 'docker.dockerfile',
      format: 'mcq',
      status: 'active',
      author: 'seed',
      prompt_version: null,
      constraints: {},
      metamorphic: {},
      sample_gate: {},
      stem_family: 'sf_layer_cache',
    });
    expect(m.ku_ids).toEqual(['docker.dockerfile.k02', 'docker.dockerfile.k03']);
    const slots = rec(m.slots);
    expect(Object.keys(slots).sort()).toEqual(['generator', 'params']);
    expect(slots.generator).toBe('t1.docker_layer_cache');
    expect(rec(slots.params)).toMatchObject({
      step_count: { type: 'int', min: 3, max: 6, step: 1 },
      changed_step: { type: 'enum' },
    });
    expect(rec(m.ext)).toMatchObject({
      'pack.kind': 't1',
      'pack.facet': 'mechanism',
      'pack.response_mode': 'recognition',
      'pack.level': 1,
      'pack.bloom': 'apply',
    });
  });
});

describe('UT-PACKC-070 BundleRecord and content_hash [FR-CUR-002]', () => {
  it('UT-PACKC-070 every bundle line parses as BundleRecord and content_hash follows rule 4 [FR-CUR-002]', () => {
    const b = build(WITH_ALL_FORMATS);
    const tar = readTar(b.fpack ?? Buffer.alloc(0));
    const bundle = tar.files.find((f) => f.name === 'bundle.jsonl')?.data.toString('utf8') ?? '';
    const lines = bundle.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines.length).toBe(b.records.records.length);
    for (const line of lines) {
      const r = BundleRecord.parse(JSON.parse(line));
      expect(canonicalJson(r)).toBe(line);
      const o = rec(r);
      if (o.kind === 'edge' || o.kind === 'alias') {
        expect(o.content_hash).toBeUndefined();
      } else if (o.kind !== 'gate_result') {
        const { content_hash, ...rest } = o;
        expect(content_hash).toBe(sha256Hex(canonicalJson(rest)));
        expect(content_hash).toBe(contentHash(rest));
      }
    }
  });

  it('UT-PACKC-070 a gate_result content_hash is the reviewed item revision hash [FR-QST-011]', () => {
    const b = build();
    const items = new Map(of(b, 'item').map((i) => [i.item_id, i.content_hash]));
    const gates = of(b, 'gate_result');
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) {
      expect(g.content_hash).toBe(items.get(g.subject_id));
    }
  });

  it('UT-PACKC-070 the G0 check turns an unrepresentable mapping into a finding [FR-CUR-002]', () => {
    const { root, contentDir } = mutatedTree();
    roots.push(root);
    const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release: false });
    expect(r.ok && r.value.clean).toBe(true);
    if (r.ok) {
      const p = prepare(r.value.ctx, 'docker');
      const broken = {
        ...p.bodies,
        entries: p.bodies.entries.map((e) => (e.kind === 'ku' ? { ...e, rec: { ...e.rec, trust: 'bogus' } } : e)),
      };
      const fin = finalizePack(broken, p.binding.gate, detUlid);
      expect(fin.findings.some((f) => f.rule === 'G0' && f.severity === 'error')).toBe(true);
      expect(fin.records.length).toBeLessThan(p.records.records.length);
    }
  });
});

describe('UT-PACKC-071 order and serialisation [FR-CUR-002]', () => {
  it('UT-PACKC-071 records are ordered by kind then by primary key, one canonicalJson line each [FR-CUR-002]', () => {
    const b = build(WITH_ALL_FORMATS);
    const order = [
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
    ];
    const kinds = b.records.records.map((r) => r.kind);
    const rank = kinds.map((k) => order.indexOf(k));
    expect(rank).toEqual([...rank].sort((x, y) => x - y));
    expect(rank).not.toContain(-1);
    const ids = (kind: string, key: string): string[] => of(b, kind).map((r) => String(r[key]));
    for (const [kind, key] of [
      ['concept', 'concept_id'],
      ['ku', 'ku_id'],
      ['misconception', 'mc_id'],
      ['item', 'item_id'],
      ['source', 'source_id'],
      ['rubric', 'rubric_id'],
      ['item_model', 'model_id'],
    ] as const) {
      expect(ids(kind, key), kind).toEqual([...ids(kind, key)].sort());
    }
    const edges = of(b, 'edge').map((e) => [e.from_concept_id, e.to_concept_id, e.edge_kind].join('|'));
    expect(edges).toEqual([...edges].sort());
    const bundle =
      readTar(b.fpack ?? Buffer.alloc(0))
        .files.find((f) => f.name === 'bundle.jsonl')
        ?.data.toString('utf8') ?? '';
    expect(bundle.endsWith('\n')).toBe(true);
    expect(bundle.includes('\n\n')).toBe(false);
  });
});

describe('UT-PACKC-072 T2 expansion is skipped [FR-CUR-009]', () => {
  it('UT-PACKC-072 t2 models and templates are not expanded and the report says T2X skipped [FR-CUR-009]', () => {
    const t2 = `  im02:
    kind: t2
    format: cloze
    facet: definition
    response_mode: production
    stem_family: sf_t2_demo
    source: { from: ku }
    template: { stem: "{{ku.cloze}}", answer: "{{ku.cloze}}" }
    constraints: {}
    metamorphic: {}
    stakes_max: S1
`;
    const b = build({ append: { 'content/packs/docker/item-models/docker.dockerfile.yaml': t2 } });
    expect(of(b, 'item_model').map((m) => m.model_id)).toEqual(['docker.dockerfile.im01']);
    expect(of(b, 'item').every((i) => i.source_kind === 'seed')).toBe(true);
    const report = JSON.parse(
      readTar(b.fpack ?? Buffer.alloc(0))
        .files.find((f) => f.name === 'report.json')
        ?.data.toString('utf8') ?? '{}',
    );
    expect(report.validators.T2X).toMatchObject({
      status: 'skipped',
      reason: 'contracts/pack/t2-expand absent (CR-32)',
    });
    expect(report.counts.t2_instances).toBe(0);
  });
});

describe('UT-PACKC-073 merkle [FR-CUR-002]', () => {
  it('UT-PACKC-073 the three verification vectors of Brief section 4.8 [FR-CUR-002]', () => {
    expect(merkleRoot(['a'])).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    for (const order of [
      ['a', 'b', 'c'],
      ['c', 'b', 'a'],
      ['b', 'c', 'a'],
    ]) {
      expect(merkleRoot(order)).toBe('535ad6d3811dc338ec7f974ee523fcc19a0fb7d68204c21818a93b0d572c4a21');
    }
    expect(merkleRoot(['{"kind":"edge"}', '{"kind":"track"}'])).toBe(
      '516a314758a680455f4dfaba37495f4586cd17278bdc32826f807ed012c8eab3',
    );
    expect(merkleRoot([])).toBe(sha256Hex(''));
  });
});

describe('UT-PACKC-074 manifest [FR-CUR-002]', () => {
  it('UT-PACKC-074 manifest parses, files carry sha256 and bytes, created_at is the latest valid_as_of [FR-CUR-002]', () => {
    const b = build();
    const tar = readTar(b.fpack ?? Buffer.alloc(0));
    const manifest = FpackManifest.parse(JSON.parse(tar.files[0]?.data.toString('utf8') ?? '{}'));
    expect(manifest).toMatchObject({
      pack_id: 'docker',
      track: 'docker',
      version: '0.1.0',
      channel: 'seed',
      schema_v: 1,
      packc_version: PACKC_VERSION,
    });
    expect(manifest.files.map((f) => f.path)).toEqual(['bundle.jsonl', 'report.json', 'layout.json']);
    for (const f of manifest.files) {
      const data = tar.files.find((x) => x.name === f.path)?.data ?? Buffer.alloc(0);
      expect(f.bytes).toBe(data.length);
      expect(f.sha256).toBe(sha256Hex(data));
    }
    expect(manifest.merkle_root).toBe(b.merkleRoot);
    expect(manifest.created_at).toBe(Date.UTC(2026, 9, 1));
    expect(manifest.created_at).toBe(dayToEpochMs('2026-10-01'));
    expect(manifest.counts).toEqual({ concepts: 5, kus: 10, misconceptions: 5, items: 22, cases: 0 });
    expect(manifest.required_for_level).toEqual({ '1': 1, '2': 0, '3': 0, '4': 0, '5': 0 });
    expect(manifest.offline_cap_level).toBe(b.bodies.cap.offline_cap_level);
    expect(tar.files[0]?.data.toString('utf8')).toBe(`${canonicalJson(manifest)}\n`);
    expect(tar.files.find((f) => f.name === 'layout.json')?.data.toString('utf8')).toBe(LAYOUT_JSON);
    const k = FpackManifest.parse(
      JSON.parse(readTar(build({}, 'k8s').fpack ?? Buffer.alloc(0)).files[0]?.data.toString('utf8') ?? '{}'),
    );
    expect(k.required_for_level['2']).toBe(1);
  });
});

describe('UT-PACKC-075 tar [FR-CUR-002]', () => {
  it('UT-PACKC-075 ustar headers, entry order, 512 alignment and the closing zero blocks [FR-CUR-002]', () => {
    const b = build();
    const buf = b.fpack ?? Buffer.alloc(0);
    expect(buf.length % 512).toBe(0);
    const tar = readTar(buf);
    expect(tar.files.map((f) => f.name)).toEqual(['manifest.json', 'bundle.jsonl', 'report.json', 'layout.json']);
    expect(tar.trailingZeroBlocks).toBe(2);
    for (const f of tar.files) {
      expect(f.header).toMatchObject({
        mode: '0000644',
        uid: '0000000',
        gid: '0000000',
        mtime: '00000000000',
        typeflag: '0',
        magic: 'ustar\0',
        version: '00',
        uname: '',
        gname: '',
        checksumOk: true,
      });
      expect(f.data.length).toBe(f.header.size);
    }
  });

  it('UT-PACKC-075 buildTar round-trips arbitrary bytes including the 512-multiple edge [FR-CUR-002]', () => {
    const entries = [
      { name: 'a.bin', data: Buffer.from([1, 2, 3]) },
      { name: 'b.bin', data: Buffer.alloc(512, 7) },
      { name: 'c.bin', data: Buffer.alloc(0) },
    ];
    const tar = readTar(buildTar(entries));
    expect(tar.files.map((f) => [f.name, f.data.toString('hex')])).toEqual(
      entries.map((e) => [e.name, e.data.toString('hex')]),
    );
    expect(() => buildTar([{ name: 'x'.repeat(101), data: Buffer.alloc(0) }])).toThrow();
  });
});

describe('UT-PACKC-076 report [FR-CUR-002][FR-CUR-005]', () => {
  it('UT-PACKC-076 report.json matches PackReport with kpi, tier_counts and cap_blockers at the top level [FR-CUR-002]', () => {
    const b = build();
    const text =
      readTar(b.fpack ?? Buffer.alloc(0))
        .files.find((f) => f.name === 'report.json')
        ?.data.toString('utf8') ?? '';
    expect(text.endsWith('\n')).toBe(true);
    const report = PackReport.parse(JSON.parse(text));
    expect(text).toBe(`${canonicalJson(report)}\n`);
    expect(report.tier_counts).toEqual({ A: 1, B: 0, C: 4 });
    expect(report.kpi.three_stage).toEqual({ full: 0.2, lite: 0, skeleton: 0.8 });
    expect(report.kpi.offline_learnable).toBe(1);
    expect(report.cap_blockers).toEqual(b.bodies.cap.cap_blockers);
    expect(report.counts.concepts_by_level).toEqual({ '1': 3, '2': 1, '3': 1, '4': 0, '5': 0 });
    expect(report.counts.items_by_format.ox).toBe(4);
    expect(report.counts.item_models).toBe(1);
    expect(report.gate_status).toEqual({ authored: 16, seed_reviewed: 6, deferred: 0, stale: [] });
    expect(report.floor).toEqual({ status: 'skipped' });
    expect(report.copy_guard).toEqual({ coverage: 0, unchecked: [] });
    expect(report.validators.V1).toMatchObject({ status: 'pass', errors: 0 });
    for (const v of ['V3', 'V4', 'V5', 'V6', 'V8', 'V9', 'V10', 'T2X'] as const) {
      expect(report.validators[v].status, v).toBe('skipped');
      expect(report.validators[v].reason, v).toBeTruthy();
    }
    expect(PackReport.safeParse({ ...report, surprise: 1 }).success).toBe(false);
  });
});

describe('UT-PACKC-077 cap [FR-CUR-025]', () => {
  it('UT-PACKC-077 per_mode caps, offline and oracle caps equal computeCap over the inventory [FR-CUR-025]', () => {
    const { root, contentDir } = mutatedTree();
    roots.push(root);
    const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release: false });
    if (!r.ok) {
      throw new Error(r.error);
    }
    const { ctx } = r.value;
    const concepts = ctx.model.concepts.filter((c) => c.disc.track === 'docker');
    const cap = computeCap(ctx.mastery, buildInventory('docker', concepts, ctx.idx, ctx.method));
    const b = buildPack({ ctx, packId: 'docker', v2Warnings: 0 });
    expect(b.bodies.cap).toEqual(cap);
    expect(cap.offline_cap_level).toBe(cap.per_mode.OFFLINE);
    expect(cap.oracle_cap_level).toBe(cap.per_mode.FULL);
    expect(Object.keys(cap.per_mode).sort()).toEqual(['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE']);
    expect(cap.per_mode.FULL).toBeGreaterThanOrEqual(cap.per_mode.OFFLINE);
    expect(cap.cap_blockers.length).toBeLessThanOrEqual(100);
    expect(one(b, 'track', 'track_id', 'docker').offline_cap_level).toBe(cap.offline_cap_level);
  });
});

describe('UT-PACKC-078 no answer leaks into stem or options [FR-QST-022]', () => {
  it('UT-PACKC-078 stem and options never carry answers, explanations, model answers, defects or h4 [FR-QST-022]', () => {
    const b = build(WITH_ALL_FORMATS);
    const FORBIDDEN_KEYS = [
      'answer',
      'correction',
      'correction_md',
      'explanation_md',
      'model_answer_md',
      'model_note_md',
      'defect_manifest',
      'h4',
      'hints',
      'pivot_md',
      'answer_key',
      'accept',
      'stdout',
      'checklist',
      'key_points',
      'idea_units',
      'expects',
      'bug_mc',
      'false_mc',
      'option_rationale',
      'distractor_mc',
    ];
    const walk = (v: unknown, path: string, out: string[]): void => {
      if (Array.isArray(v)) {
        for (const [i, x] of v.entries()) {
          walk(x, `${path}.${i}`, out);
        }
      } else if (isRec(v)) {
        for (const [k, x] of Object.entries(v)) {
          if (FORBIDDEN_KEYS.includes(k)) {
            out.push(`${path}.${k}`);
          }
          walk(x, `${path}.${k}`, out);
        }
      }
    };
    for (const i of of(b, 'item')) {
      const leaks: string[] = [];
      walk(i.stem, `${String(i.item_id)}.stem`, leaks);
      walk(i.options, `${String(i.item_id)}.options`, leaks);
      expect(leaks).toEqual([]);
      const text = JSON.stringify([i.stem, i.options]);
      expect(text.includes(String(i.explanation_md)), String(i.item_id)).toBe(false);
    }
    const sources = readFileSync(join(FIXTURES, '..', 'src/emit/records.ts'), 'utf8');
    expect(sources).toContain('정답·해설·모범답안·결함은 stem·options에 넣지 않는다');
  });
});

describe('UT-PACKC-079 output [FR-CUR-002]', () => {
  it('UT-PACKC-079 the file is <pack_id>@<version>.fpack, written atomically with no leftover tmp [FR-CUR-002]', () => {
    const b = build();
    expect(b.fileName).toBe('docker@0.1.0.fpack');
    const { root } = mutatedTree();
    roots.push(root);
    const out = join(root, 'dist/packs');
    const path = writeFpack(out, b);
    expect(path).toBe(join(out, 'docker@0.1.0.fpack'));
    expect(readdirSync(out)).toEqual(['docker@0.1.0.fpack']);
    expect(readFileSync(path).equals(b.fpack ?? Buffer.alloc(0))).toBe(true);
    const bad = { ...b, fpack: null };
    expect(() => writeFpack(out, bad)).toThrow();
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('UT-PACKC-079 det-ULID is a 26-char Crockford id, deterministic and ordered by time [FR-QST-011]', () => {
    const a = detUlid(dayToEpochMs('2026-10-01'), 'seed');
    expect(Ulid.safeParse(a).success).toBe(true);
    expect(detUlid(dayToEpochMs('2026-10-01'), 'seed')).toBe(a);
    expect(detUlid(dayToEpochMs('2026-10-01'), 'other')).not.toBe(a);
    expect(detUlid(dayToEpochMs('2026-10-02'), 'seed') > a).toBe(true);
    expect(subjectHash({ a: 1, gate_status: 'x', s2_mode: null, content_hash: 'h' })).toBe(
      sha256Hex(canonicalJson({ a: 1 })),
    );
    expect(FormatId.options).toHaveLength(33);
  });
});
