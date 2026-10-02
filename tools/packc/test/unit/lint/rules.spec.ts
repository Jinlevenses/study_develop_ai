// UT-PACKC-030~041 — V2 lint 규칙 세부(R-ID·R-DAG·R-LVL·R-REF·R-SRC·R-3STAGE·R-REQ·R-ALIAS·요청 파일 출처).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../../../src/lint/run.js';
import type { Finding } from '../../../src/validate/finding.js';
import type { Mutation } from '../cli/helpers.js';
import { FIXTURES, mutatedTree, REPO_POLICY, rmTmp } from '../cli/helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});

function lint(m: Mutation = {}, release = false): Finding[] {
  const { root, contentDir } = mutatedTree(m);
  roots.push(root);
  const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release });
  if (!r.ok) {
    throw new Error(r.error);
  }
  return [...r.value.findings];
}

function of(list: readonly Finding[], rule: string): Finding[] {
  return list.filter((f) => f.rule === rule);
}

const base = (rel: string): string => readFileSync(join(FIXTURES, 'base/content', rel), 'utf8');
const PROBES = 'content/packs/k8s/concepts/k8s.probes.md';
const LAYER = 'content/packs/docker/concepts/docker.image-layer.md';
const DFILE = 'content/packs/docker/concepts/docker.dockerfile.md';
const KITEMS = 'content/packs/k8s/items/k8s.probes.yaml';

describe('UT-PACKC-030 R-ID details [FR-CUR-004]', () => {
  it('UT-PACKC-030 the base tree has no R-ID finding; alias collisions and duplicate aliases are reported [FR-CUR-004]', () => {
    expect(of(lint(), 'R-ID')).toEqual([]);
    const aliasCollision = lint({ replace: [{ file: PROBES, from: 'id_aliases: []', to: 'id_aliases: [k8s.pod]' }] });
    expect(of(aliasCollision, 'R-ID').some((f) => f.message.includes('collides'))).toBe(true);
    const selfAlias = lint({ replace: [{ file: PROBES, from: 'id_aliases: []', to: 'id_aliases: [k8s.probes]' }] });
    expect(of(selfAlias, 'R-ID').some((f) => f.message.includes('equals the current id'))).toBe(true);
  });

  it('UT-PACKC-030 namespace, file name, reserved slug and orphan files are R-ID errors [FR-CUR-004]', () => {
    const wrongNs = lint({
      replace: [
        {
          file: 'content/packs/docker/concepts/docker.run-lifecycle.md',
          from: 'id: docker.run-lifecycle\n',
          to: 'id: k8s.run-lifecycle\n',
        },
      ],
    });
    expect(of(wrongNs, 'R-ID').some((f) => f.message.includes('R-NS'))).toBe(true);
    expect(of(wrongNs, 'R-ID').some((f) => f.message.includes('R-FILE'))).toBe(true);
    const reserved = lint({
      write: {
        'content/packs/docker/concepts/docker.lab.md': base('packs/docker/concepts/docker.image-layer.md').replace(
          'docker.image-layer',
          'docker.lab',
        ),
      },
    });
    expect(of(reserved, 'R-ID').some((f) => f.message.includes('R-ID-SLUG'))).toBe(true);
    const orphan = lint({
      write: {
        'content/packs/docker/kus/docker.ghost.yaml': base('packs/k8s/kus/k8s.probes.yaml').replace(
          'k8s.probes',
          'docker.ghost',
        ),
      },
    });
    expect(of(orphan, 'R-ID').some((f) => f.message.includes('orphan'))).toBe(true);
  });

  it('UT-PACKC-030 rubric, template, request and V7 names are R-ID checked [FR-CUR-004]', () => {
    const rubric = base('templates/rubrics/solo-5.yaml');
    const mismatch = lint({
      write: { 'content/packs/docker/rubrics/mine.yaml': rubric.replace('rb.solo-5', 'rb.other') },
    });
    expect(of(mismatch, 'R-ID').some((f) => f.message.includes("'rb.mine'"))).toBe(true);
    const collide = lint({ write: { 'content/packs/docker/rubrics/solo-5.yaml': rubric } });
    expect(of(collide, 'R-ID').some((f) => f.message.includes('collides with a shared rubric'))).toBe(true);
    const tpl = lint({
      replace: [{ file: 'content/templates/dig/generic-01.yaml', from: 'id: generic-01', to: 'id: generic-02' }],
    });
    expect(of(tpl, 'R-ID').some((f) => f.message.includes('template id'))).toBe(true);
    const v7 = lint({
      replace: [{ file: 'content/review/V7/docker/v7.docker.001.yaml', from: 'pack_id: docker', to: 'pack_id: k8s' }],
    });
    expect(of(v7, 'R-ID').some((f) => f.message.includes('pack_id'))).toBe(true);
    const batch = lint({
      replace: [
        {
          file: 'content/review/V7/docker/v7.docker.001.yaml',
          from: 'batch_id: v7.docker.001',
          to: 'batch_id: v7.docker.002',
        },
      ],
    });
    expect(of(batch, 'R-ID').some((f) => f.message.includes('file name'))).toBe(true);
  });
});

describe('UT-PACKC-031 R-DAG [FR-CUR-004]', () => {
  it('UT-PACKC-031 reports one finding per cycle, rotated to start at the smallest id [FR-CUR-004]', () => {
    const list = lint({ replace: [{ file: LAYER, from: 'prereqs: []', to: 'prereqs: [docker.dockerfile]' }] });
    const dag = of(list, 'R-DAG');
    expect(dag).toHaveLength(1);
    expect(dag[0]?.message).toBe('prerequisite cycle: docker.dockerfile → docker.image-layer → docker.dockerfile');
    expect(dag[0]?.file).toBe('packs/docker/concepts/docker.dockerfile.md');
  });

  it('UT-PACKC-031 a self loop and two disjoint cycles are each one finding; acyclic trees have none [FR-CUR-004]', () => {
    expect(of(lint(), 'R-DAG')).toEqual([]);
    const self = lint({ replace: [{ file: LAYER, from: 'prereqs: []', to: 'prereqs: [docker.image-layer]' }] });
    expect(of(self, 'R-DAG').map((f) => f.message)).toEqual([
      'prerequisite cycle: docker.image-layer → docker.image-layer',
    ]);
    const two = lint({
      replace: [
        { file: LAYER, from: 'prereqs: []', to: 'prereqs: [docker.dockerfile]' },
        {
          file: 'content/packs/docker/concepts/docker.run-lifecycle.md',
          from: 'prereqs: []',
          to: 'prereqs: [docker.dev-environment]',
        },
        {
          file: 'content/packs/docker/concepts/docker.dev-environment.md',
          from: 'prereqs: []',
          to: 'prereqs: [docker.run-lifecycle]',
        },
      ],
    });
    expect(of(two, 'R-DAG')).toHaveLength(2);
  });

  it('UT-PACKC-031 cycles across packs are found (the whole tree is loaded) [FR-CUR-004]', () => {
    const list = lint({ replace: [{ file: DFILE, from: 'prereqs: [docker.image-layer]', to: 'prereqs: [k8s.pod]' }] });
    expect(of(list, 'R-DAG').map((f) => f.message)).toEqual([
      'prerequisite cycle: docker.dockerfile → k8s.pod → docker.dockerfile',
    ]);
  });
});

describe('UT-PACKC-032 R-LVL [FR-CUR-004]', () => {
  it('UT-PACKC-032 prereq one level above is a warning, two or more is an error [FR-CUR-004]', () => {
    const warn = lint({ replace: [{ file: LAYER, from: 'prereqs: []', to: 'prereqs: [docker.dev-environment]' }] });
    expect(of(warn, 'R-LVL').map((f) => f.severity)).toEqual(['warn']);
    const error = lint({ replace: [{ file: LAYER, from: 'prereqs: []', to: 'prereqs: [docker.image-security]' }] });
    expect(of(error, 'R-LVL').map((f) => f.severity)).toEqual(['error']);
    expect(of(lint(), 'R-LVL')).toEqual([]);
  });
});

describe('UT-PACKC-033 R-REF concept, ku, mc, rubric, source, directive [FR-CUR-003][FR-CUR-012]', () => {
  it('UT-PACKC-033 concept references: prereqs, siblings, extends, deprecated_by [FR-CUR-003]', () => {
    for (const [from, to, key] of [
      ['prereqs: [k8s.pod]', 'prereqs: [k8s.ghost]', 'prereqs.0'],
      ['siblings: {}', 'siblings:\n  k8s.ghost: { axis: "축 설명" }', 'siblings.k8s.ghost'],
      ['extends: []', 'extends: [k8s.ghost]', 'extends.0'],
      ['deprecated_by: null', 'deprecated_by: k8s.ghost', 'deprecated_by'],
    ] as const) {
      const refs = of(lint({ replace: [{ file: PROBES, from, to }] }), 'R-REF');
      expect(
        refs.some((f) => f.keypath === key),
        key,
      ).toBe(true);
    }
  });

  it('UT-PACKC-033 ku and mc references: deprecated_by, refutes, item refs [FR-CUR-003]', () => {
    const ku = lint({
      replace: [
        {
          file: 'content/packs/k8s/kus/k8s.probes.yaml',
          from: 'level_min: 2\n    bloom_affordance: [remember, understand]',
          to: 'level_min: 2\n    deprecated_by: k99\n    bloom_affordance: [remember, understand]',
        },
      ],
    });
    expect(of(ku, 'R-REF').some((f) => f.keypath === 'kus.k01.deprecated_by')).toBe(true);
    const mc = lint({
      replace: [
        { file: 'content/packs/k8s/misconceptions/k8s.probes.yaml', from: 'refutes: [k02]', to: 'refutes: [k99]' },
      ],
    });
    expect(of(mc, 'R-REF').some((f) => f.keypath === 'mcs.m01.refutes.0')).toBe(true);
    const items = lint({
      replace: [
        {
          file: KITEMS,
          from: '    ku_refs: [k01]\n    stem_family: sf_probe_kinds',
          to: '    ku_refs: [k99]\n    stem_family: sf_probe_kinds',
        },
        { file: KITEMS, from: '    false_mc: m01', to: '    false_mc: m77' },
      ],
    });
    expect(of(items, 'R-REF').some((f) => f.keypath === 'items.i01.ku_refs.0')).toBe(true);
    expect(of(items, 'R-REF').some((f) => f.keypath === 'items.i02.false_mc')).toBe(true);
  });

  it('UT-PACKC-033 a full id points to another concept and local refs stay in the same concept [FR-CUR-003]', () => {
    const ok = lint({
      replace: [
        {
          file: KITEMS,
          from: '    ku_refs: [k01]\n    stem_family: sf_probe_kinds',
          to: '    ku_refs: [k01, docker.dockerfile.k01]\n    stem_family: sf_probe_kinds',
        },
      ],
    });
    expect(of(ok, 'R-REF')).toEqual([]);
    const bad = lint({
      replace: [
        {
          file: KITEMS,
          from: '    ku_refs: [k01]\n    stem_family: sf_probe_kinds',
          to: '    ku_refs: [k01, docker.dockerfile.k77]\n    stem_family: sf_probe_kinds',
        },
      ],
    });
    expect(of(bad, 'R-REF')).toHaveLength(1);
  });

  it('UT-PACKC-033 rubric references resolve against shared and same-pack rubrics only [FR-CUR-003]', () => {
    const file = 'content/packs/docker/items/docker.dockerfile.yaml';
    expect(
      of(lint({ replace: [{ file, from: 'rubric: rb.explain-generic', to: 'rubric: rb.nope-generic' }] }), 'R-REF'),
    ).toHaveLength(1);
    const rubric = base('templates/rubrics/solo-5.yaml').replace('rb.solo-5', 'rb.k8s-only');
    const otherPack = lint({
      replace: [{ file, from: 'rubric: rb.explain-generic', to: 'rubric: rb.k8s-only' }],
      write: { 'content/packs/k8s/rubrics/k8s-only.yaml': rubric },
    });
    expect(of(otherPack, 'R-REF')).toHaveLength(1);
    const samePack = lint({
      replace: [{ file, from: 'rubric: rb.explain-generic', to: 'rubric: rb.docker-only' }],
      write: { 'content/packs/docker/rubrics/docker-only.yaml': rubric.replace('rb.k8s-only', 'rb.docker-only') },
    });
    expect(of(samePack, 'R-REF')).toEqual([]);
  });

  it('UT-PACKC-033 sources must exist; embed, lab, case and concept links are checked [FR-CUR-003]', () => {
    expect(
      of(
        lint({ replace: [{ file: PROBES, from: 'source_id: src.k8s-docs', to: 'source_id: src.nope-docs' }] }),
        'R-REF',
      ),
    ).toHaveLength(1);
    const embedUnknown = lint({
      replace: [{ file: DFILE, from: '::embed[docker.dockerfile.i13]', to: '::embed[docker.dockerfile.i99]' }],
    });
    expect(of(embedUnknown, 'R-REF').some((f) => f.message.includes('unknown item'))).toBe(true);
    const lab = lint({ replace: [{ file: DFILE, from: '단계 과제는 랩 WP에서 추가한다.', to: '::case[k8s.case.x]' }] });
    expect(of(lab, 'R-REF').some((f) => f.message.startsWith('unsupported-in-it01'))).toBe(true);
    const link = lint({ replace: [{ file: DFILE, from: 'concept:docker.image-security', to: 'concept:docker.nope' }] });
    expect(of(link, 'R-REF').some((f) => f.message.includes('concept:docker.nope'))).toBe(true);
    const diagram = lint({ replace: [{ file: DFILE, from: '```mermaid dg_build_flow', to: '```mermaid dg_other' }] });
    expect(of(diagram, 'R-REF').length).toBeGreaterThanOrEqual(2);
    const malformed = lint({ replace: [{ file: DFILE, from: '::ku-list', to: '::ku-list extra' }] });
    expect(of(malformed, 'R-REF').some((f) => f.message.includes('malformed directive'))).toBe(true);
  });
});

const ITEM_BASE = {
  facet: 'definition',
  response_mode: 'recognition',
  level: 2,
  bloom: 'understand',
  stem_family: 'sf_demo',
  gate_status: 'authored',
};
const common = (extra = ''): string => {
  const head = Object.entries(ITEM_BASE)
    .map(([k, v]) => `    ${k}: ${v}`)
    .join('\n');
  return `${head}\n    ku_refs: [k01]\n    explanation_md: "설명 설명 설명 설명 설명 설명 설명"\n${extra}`;
};

function addItems(body: string): Mutation {
  return { append: { [KITEMS]: body } };
}

describe('UT-PACKC-034 R-REF item internal keys [FR-CUR-003]', () => {
  const run = (items: string): Finding[] => of(lint(addItems(items)), 'R-REF');
  const keys = (items: string): string[] => run(items).map((f) => f.keypath);

  it('UT-PACKC-034 mcq answer and rationale/distractor keys must be option keys [FR-CUR-003]', () => {
    const k = keys(
      `  i06:\n    format: mcq\n${common()}    stem: "질문 질문 질문 질문 질문"\n    options: { opt_a: "가", opt_b: "나" }\n    answer: opt_c\n    distractor_mc: { opt_d: m01 }\n    option_rationale: { opt_e: "근거 근거 근거" }\n`,
    );
    expect(k).toEqual(
      expect.arrayContaining(['items.i06.answer', 'items.i06.distractor_mc.opt_d', 'items.i06.option_rationale.opt_e']),
    );
  });

  it('UT-PACKC-034 mcq_multi, order, matching, parsons, cond_reversal keys [FR-CUR-003]', () => {
    const k = keys(
      [
        `  i06:\n    format: mcq_multi\n${common()}    stem: "질문 질문 질문 질문 질문"\n    options: { opt_a: "가", opt_b: "나", opt_c: "다", opt_d: "라" }\n    answer: { opt_e: true }\n`,
        `  i07:\n    format: order\n${common()}    stem: "질문 질문 질문 질문 질문"\n    steps: { s_a: "가가", s_b: "나나", s_c: "다다" }\n    answer: [s_a, s_b, s_x]\n`,
        `  i08:\n    format: matching\n${common()}    stem: "질문 질문 질문 질문 질문"\n    left: { l_a: "가", l_b: "나" }\n    right: { r_a: "가" }\n    answer: { l_a: r_z }\n`,
        `  i09:\n    format: parsons\n${common()}    stem: "질문 질문 질문 질문 질문"\n    lang: ts\n    lines: { ln_a: "a" }\n    answer: [ln_a, ln_b, ln_c]\n`,
        `  i10:\n    format: cond_reversal\n${common()}    scenario: "상황 상황 상황 상황 상황 상황 상황"\n    conditions: { cond_a: "조건 조건 조건 조건", cond_b: "조건 조건 조건 조건" }\n    options: { opt_a: "가", opt_b: "나" }\n    answer: { cond_a: opt_a, cond_b: opt_c }\n    pivot_md: "전환 전환 전환 전환"\n`,
      ].join(''),
    );
    expect(k).toEqual(
      expect.arrayContaining([
        'items.i06.answer.opt_e',
        'items.i07.answer',
        'items.i08.answer',
        'items.i08.answer.l_a',
        'items.i09.answer.1',
        'items.i09.answer.2',
        'items.i10.answer.cond_b',
      ]),
    );
  });

  it('UT-PACKC-034 embedded shape, cloze placeholders and defect manifests [FR-CUR-003]', () => {
    const k = keys(
      [
        `  i06:\n    format: embedded\n${common()}    shape: mcq\n    stem: "질문 질문 질문 질문 질문"\n    answer: true\n`,
        `  i07:\n    format: embedded\n${common()}    shape: ox\n    stem: "질문 질문 질문 질문 질문"\n    answer: opt_a\n    options: { opt_a: "가" }\n`,
        `  i08:\n    format: cloze\n${common()}    stem: "빈칸 {{b1}} 그리고 {{b2}} 질문"\n    blanks: { b1: { accept: ["가"] }, b3: { accept: ["나"] } }\n`,
        `  i09:\n    format: error_find\n${common()}    stem: "질문 질문 질문 질문 질문"\n    code: { lang: ts, src: "let a = 1;" }\n    answer: { from: 5, to: 2 }\n    bug_mc: m55\n`,
        `  i10:\n    format: config_review\n${common()}    stem: "질문 질문 질문 질문 질문"\n    artifact: { lang: yaml, src: "a: 1" }\n    defect_manifest:\n      df_a: { from: 3, to: 1, rule: r, severity: high, mc_ref: m66, note: "설명 설명 설명" }\n`,
      ].join(''),
    );
    expect(k).toEqual(
      expect.arrayContaining([
        'items.i06.options',
        'items.i07.options',
        'items.i07.answer',
        'items.i08.stem',
        'items.i09.answer',
        'items.i09.bug_mc',
        'items.i10.defect_manifest.df_a',
        'items.i10.defect_manifest.df_a.mc_ref',
      ]),
    );
  });

  it('UT-PACKC-034 blank_note, essay, digging, feynman, audit and pr_review refs [FR-CUR-003]', () => {
    const k = keys(
      [
        `  i06:\n    format: blank_note\n${common()}    prompt: "질문 질문 질문 질문 질문"\n    idea_units: { iu_a: { text: "t", ku_ref: k88, keywords: [a] } }\n    solo_rubric: rb.nope\n    model_note_md: "${'모범 '.repeat(20)}"\n`,
        `  i07:\n    format: digging\n${common()}    depth: d1\n    question: "질문 질문 질문 질문 질문"\n    expects: { kp_a: { text: "t", ku_ref: k88 } }\n    followups: { fu_a: { when: partial, mc_ref: m99, question: "추가 질문 추가 질문" } }\n`,
        `  i08:\n    format: feynman\n${common()}    student_persona: "학생 학생 학생 학생"\n    student_beliefs: { sb_a: { mc_ref: m99, opening_line: "안녕하세요 안녕하세요" } }\n    checklist: { ck_a: { text: "t", ku_ref: k88 } }\n    rubric: rb.nope\n`,
        `  i09:\n    format: pr_review\n${common()}    prompt: "질문 질문 질문 질문 질문"\n    diff: { lang: diff, src: "+a" }\n    defect_manifest:\n      df_a: { file: a.ts, from: 9, to: 2, kind: security_weakness, note: "설명 설명 설명" }\n`,
        `  i10:\n    format: audit\n${common()}    prompt: "질문 질문 질문 질문 질문"\n    artifact_md: "${'본문 '.repeat(40)}"\n    defect_manifest:\n      df_a: { quote: "q", kind: factual, mc_ref: m99, correction: "수정 수정 수정" }\n`,
        `  i11:\n    format: essay\n${common()}    prompt: "질문 질문 질문 질문 질문"\n    key_points: { kp_a: { text: "t", ku_ref: k88 } }\n    rubric: rb.nope\n    model_answer_md: "${'모범 '.repeat(20)}"\n`,
        `  i12:\n    format: fermi\n${common()}    stem: "질문 질문 질문 질문 질문 질문 질문 질문"\n    answer: { value: 5, unit: ms }\n    assumptions_rubric: rb.nope\n`,
      ].join(''),
    );
    expect(k).toEqual(
      expect.arrayContaining([
        'items.i06.idea_units.iu_a.ku_ref',
        'items.i06.solo_rubric',
        'items.i07.expects.kp_a.ku_ref',
        'items.i07.followups.fu_a.mc_ref',
        'items.i08.student_beliefs.sb_a.mc_ref',
        'items.i08.checklist.ck_a.ku_ref',
        'items.i08.rubric',
        'items.i09.defect_manifest.df_a',
        'items.i10.defect_manifest.df_a.mc_ref',
        'items.i11.key_points.kp_a.ku_ref',
        'items.i11.rubric',
        'items.i12.assumptions_rubric',
      ]),
    );
  });
});

describe('UT-PACKC-035 R-SRC [FR-CUR-004]', () => {
  it('UT-PACKC-035 Tier A needs 2 sources, Tier B and C need 1 [FR-CUR-004]', () => {
    expect(of(lint(), 'R-SRC')).toEqual([]);
    const onlyOne = base('packs/docker/concepts/docker.dockerfile.md')
      .split('\n')
      .filter((l) => !l.includes('/build/building/best-practices/"') || l.includes('section: "Dockerfile reference"'))
      .join('\n');
    const lines = onlyOne.split('\n').filter((l) => !l.includes('/build/concepts/context/'));
    const a = lint({ write: { [DFILE]: lines.join('\n') } });
    expect(of(a, 'R-SRC').map((f) => f.message)).toEqual(['Tier A needs at least 2 sources (has 1)']);
    const srcLine =
      base('packs/k8s/concepts/k8s.probes.md')
        .split('\n')
        .find((l) => l.startsWith('  - { source_id')) ?? '';
    const b = lint({ replace: [{ file: PROBES, from: `sources:\n${srcLine}`, to: 'sources: []' }] });
    expect(of(b, 'R-SRC').map((f) => f.message)).toEqual(['Tier B needs at least 1 sources (has 0)']);
    const cLine =
      base('packs/docker/concepts/docker.image-layer.md')
        .split('\n')
        .find((l) => l.startsWith('  - { source_id')) ?? '';
    const c = lint({ replace: [{ file: LAYER, from: `sources:\n${cLine}`, to: 'sources: []' }] });
    expect(of(c, 'R-SRC').map((f) => f.message)).toEqual(['Tier C needs at least 1 sources (has 0)']);
  });
});

describe('UT-PACKC-036 R-3STAGE Tier A [FR-CUR-005]', () => {
  const messages = (m: Mutation): string[] => of(lint(m), 'R-3STAGE').map((f) => f.message);

  it('UT-PACKC-036 the DCP sample passes with theory 921 characters [FR-CUR-005]', () => {
    expect(messages({})).toEqual([]);
  });

  it('UT-PACKC-036 theory length bounds, headings, mermaid and embed [FR-CUR-005]', () => {
    const long = lint({
      replace: [
        {
          file: DFILE,
          from: '이미지를 손으로 만들면',
          to: `${'길게 늘린 문장입니다. '.repeat(30)}이미지를 손으로 만들면`,
        },
      ],
    });
    expect(of(long, 'R-3STAGE').some((f) => f.message.includes('800..1200'))).toBe(true);
    const short = lint({ replace: [{ file: DFILE, from: '### 메커니즘', to: '### 메커니즘 ' }] });
    expect(of(short, 'R-3STAGE')).toEqual([]);
    expect(messages({ replace: [{ file: DFILE, from: '### 메커니즘', to: '### 동작' }] })).toContain(
      "Tier A theory needs a '### 메커니즘' heading",
    );
    expect(messages({ replace: [{ file: DFILE, from: '### 왜 필요한가', to: '### 이유' }] })).toContain(
      "Tier A theory needs a '### 왜 필요한가' heading",
    );
    expect(messages({ replace: [{ file: DFILE, from: '```mermaid dg_build_flow', to: '```text' }] })).toContain(
      'Tier A theory needs at least one mermaid fence',
    );
    expect(messages({ replace: [{ file: DFILE, from: '::embed[docker.dockerfile.i13]\n', to: '' }] })).toContain(
      'Tier A theory needs at least one ::embed directive',
    );
  });

  it('UT-PACKC-036 learning block, worked example, subgoal marker, step task and case [FR-CUR-005]', () => {
    const noLearning = base('packs/docker/concepts/docker.dockerfile.md');
    const a = noLearning.indexOf('learning:');
    const b = noLearning.indexOf('review:');
    expect(messages({ write: { [DFILE]: noLearning.slice(0, a) + noLearning.slice(b) } })).toContain(
      'Tier A requires a learning block',
    );
    expect(messages({ replace: [{ file: DFILE, from: '### Worked example', to: '### 예제' }] })).toContain(
      "stage2_kind code needs a '### Worked example' heading",
    );
    expect(messages({ replace: [{ file: DFILE, from: '# ① 베이스', to: '# 베이스' }] })).toContain(
      "stage2_kind code needs the '①' subgoal marker inside a code fence",
    );
    expect(messages({ replace: [{ file: DFILE, from: '### 단계 과제', to: '### 과제' }] })).toContain(
      "knowledge_type P needs a '### 단계 과제' heading",
    );
    expect(messages({ replace: [{ file: DFILE, from: 'stage2_kind: code', to: 'stage2_kind: case' }] })).toContain(
      "stage2_kind case needs a '### 사례' section with at least 3 sentences",
    );
  });

  it('UT-PACKC-036 core: at least 2 list items, contrast heading, ku-list [FR-CUR-005]', () => {
    expect(
      messages({
        replace: [
          {
            file: DFILE,
            from: '- 개발 중 파일을 저장할 때마다 다시 빌드하지 않는다. 그 단계에서는 바인드 마운트가 맞다(→ [개발 환경](concept:docker.dev-environment)).\n',
            to: '',
          },
          { file: DFILE, from: '- 토큰·비밀번호를', to: '토큰·비밀번호를' },
        ],
      }),
    ).toContain("'### 언제 쓰지 않나' needs at least 2 list items");
    expect(messages({ replace: [{ file: DFILE, from: '### 대조', to: '### 비교' }] })).toContain(
      "contrast_pairs need a '### 대조' heading",
    );
    expect(messages({ replace: [{ file: DFILE, from: '::ku-list', to: '' }] })).toContain(
      'core needs a ::ku-list line',
    );
  });

  it('UT-PACKC-036 H1, preamble, section order and unclosed fences [FR-CUR-005]', () => {
    expect(messages({ replace: [{ file: DFILE, from: '## 이론\n', to: '# 제목\n## 이론\n' }] })).toContain(
      'H1 headings are not allowed in the body',
    );
    expect(messages({ replace: [{ file: DFILE, from: '## 이론\n', to: '서문\n\n## 이론\n' }] })).toContain(
      'text before the first H2 is not allowed',
    );
    expect(
      messages({ replace: [{ file: DFILE, from: '## 코드', to: '## 핵심 요약' }] }).some((m) =>
        m.startsWith('H2 sections must be exactly'),
      ),
    ).toBe(true);
    expect(messages({ append: { [DFILE]: '\n```ts\nopen\n' } })).toContain('unclosed code fence');
  });
});

describe('UT-PACKC-037 R-3STAGE Tier B [FR-CUR-005]', () => {
  const messages = (m: Mutation): string[] => of(lint(m), 'R-3STAGE').map((f) => f.message);
  it('UT-PACKC-037 sentence and length bounds, first fence size or case section, ku-list [FR-CUR-005]', () => {
    expect(messages({})).toEqual([]);
    expect(
      messages({
        replace: [
          {
            file: PROBES,
            from: '프로브(probe)는 kubelet이 컨테이너 상태를 주기적으로 확인하는 검사다. liveness 프로브가 실패하면 컨테이너를 재시작하고, readiness 프로브가 실패하면 서비스 엔드포인트에서 Pod를 뺀다.',
            to: '문장 부호 없는 설명',
          },
        ],
      }),
    ).toContain('Tier B theory needs at least one sentence');
    expect(
      messages({
        replace: [{ file: PROBES, from: '검사다. liveness', to: `검사다. ${'아주 긴 설명이다. '.repeat(40)}liveness` }],
      }).some((m) => m.includes('at most 400')),
    ).toBe(true);
    const longFence = `\`\`\`yaml\n${'a: 1\n'.repeat(16)}\`\`\``;
    expect(
      messages({
        replace: [
          {
            file: PROBES,
            from: '```yaml\nreadinessProbe:\n  httpGet: { path: /healthz, port: 8080 }\n  periodSeconds: 5\n```',
            to: longFence,
          },
        ],
      }).some((m) => m.includes('15 lines')),
    ).toBe(true);
    const caseOnly =
      '### 사례\n\n배포 직후 트래픽이 몰렸다. readiness 프로브가 늦게 통과했다. 그래서 엔드포인트 등록이 늦었다.';
    expect(
      messages({
        replace: [
          {
            file: PROBES,
            from: '```yaml\nreadinessProbe:\n  httpGet: { path: /healthz, port: 8080 }\n  periodSeconds: 5\n```',
            to: caseOnly,
          },
        ],
      }),
    ).toEqual([]);
    expect(messages({ replace: [{ file: PROBES, from: '::ku-list', to: '' }] })).toContain(
      'core needs a ::ku-list line',
    );
  });
});

describe('UT-PACKC-038 R-3STAGE Tier C [FR-CUR-005]', () => {
  const messages = (m: Mutation): string[] => of(lint(m), 'R-3STAGE').map((f) => f.message);
  it('UT-PACKC-038 theory = summary_ko, code = ::needs-enrichment, core = the 3-line template, no learning [FR-CUR-005]', () => {
    expect(messages({})).toEqual([]);
    expect(messages({ replace: [{ file: LAYER, from: '## 이론\n\n', to: '## 이론\n\n덧붙임 ' }] })).toContain(
      'Tier C theory must equal summary_ko exactly',
    );
    expect(messages({ replace: [{ file: LAYER, from: '::needs-enrichment', to: '직접 쓴 코드' }] })).toContain(
      'Tier C code must be exactly ::needs-enrichment',
    );
    expect(messages({ replace: [{ file: LAYER, from: '- 무엇인가:', to: '- 정의:' }] })).toContain(
      'Tier C core must equal the 3-line skeleton template',
    );
    expect(
      messages({
        replace: [
          {
            file: LAYER,
            from: 'review:',
            to: 'learning:\n  objectives:\n    ob_1: { bloom: understand, text: "목표 목표 목표 목표 목표" }\n    ob_2: { bloom: apply, text: "목표 목표 목표 목표 목표" }\n    ob_3: { bloom: analyze, text: "목표 목표 목표 목표 목표" }\n  pre_questions: ["질문 질문 질문 질문 질문", "질문 질문 질문 질문 질문"]\n  estimated_minutes: { theory: 1, code: 0, core: 1 }\nreview:',
          },
        ],
      }),
    ).toContain('Tier C must not have a learning block');
  });
});

describe('UT-PACKC-039 R-REQ [FR-CUR-004]', () => {
  it('UT-PACKC-039 Tier A/B need required_for_level = level, Tier C null [FR-CUR-004]', () => {
    expect(of(lint(), 'R-REQ')).toEqual([]);
    expect(
      of(lint({ replace: [{ file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: 3' }] }), 'R-REQ'),
    ).toHaveLength(1);
    expect(
      of(lint({ replace: [{ file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' }] }), 'R-REQ'),
    ).toHaveLength(1);
    expect(
      of(lint({ replace: [{ file: LAYER, from: 'required_for_level: null', to: 'required_for_level: 1' }] }), 'R-REQ'),
    ).toHaveLength(1);
  });
});

describe('UT-PACKC-040 R-ALIAS [FR-CUR-004]', () => {
  it('UT-PACKC-040 a Korean title needs a Latin alias; an English-only title does not [FR-CUR-004]', () => {
    expect(of(lint(), 'R-ALIAS')).toEqual([]);
    expect(
      of(
        lint({ replace: [{ file: PROBES, from: 'aliases: ["Probes", "헬스 체크"]', to: 'aliases: ["헬스 체크"]' }] }),
        'R-ALIAS',
      ),
    ).toHaveLength(1);
    const english = lint({
      replace: [
        {
          file: PROBES,
          from: 'title: { ko: "프로브(Liveness·Readiness)", en: "Probes" }',
          to: 'title: { ko: "Probes", en: "Probes" }',
        },
        { file: PROBES, from: 'aliases: ["Probes", "헬스 체크"]', to: 'aliases: ["프로브"]' },
      ],
    });
    expect(of(english, 'R-ALIAS')).toEqual([]);
  });
});

describe('UT-PACKC-041 source request files [FR-CUR-012]', () => {
  const entry = (): string => {
    const text = base('sources/registry.yaml');
    const start = text.indexOf('  src.node-docs:');
    const end = text.indexOf('  src.', start + 5);
    return text
      .slice(start, end)
      .replace('src.node-docs', 'src.new-docs')
      .split('\n')
      .filter((l) => l !== '')
      .join('\n');
  };
  const request = (merged: boolean, extra = ''): string =>
    `schema_v: 1\nwp: WP-T-demo\nrequests:\n${entry()}\n    reason: "신규 출처가 필요하다"\n    merged: ${merged}\n${extra}`;
  const use = { replace: [{ file: PROBES, from: 'source_id: src.k8s-docs', to: 'source_id: src.new-docs' }] } as const;

  it('UT-PACKC-041 a source that exists only in a request file resolves; an unknown one does not [FR-CUR-012]', () => {
    const ok = lint({ ...use, write: { 'content/sources/requests/WP-T-demo.yaml': request(false) } });
    expect(of(ok, 'R-REF')).toEqual([]);
    expect(of(ok, 'R-ID')).toEqual([]);
    expect(of(lint(use), 'R-REF')).toHaveLength(1);
  });

  it('UT-PACKC-041 a request already in the registry must be merged; duplicates across requests are errors [FR-CUR-012]', () => {
    const inRegistry = request(false).replace('src.new-docs', 'src.docker-docs');
    const a = lint({ write: { 'content/sources/requests/WP-T-demo.yaml': inRegistry } });
    expect(of(a, 'R-ID').some((f) => f.message.includes('not merged'))).toBe(true);
    const merged = lint({
      write: { 'content/sources/requests/WP-T-demo.yaml': inRegistry.replace('merged: false', 'merged: true') },
    });
    expect(of(merged, 'R-ID')).toEqual([]);
    const dup = lint({
      write: {
        'content/sources/requests/WP-T-demo.yaml': request(false),
        'content/sources/requests/WP-T-other.yaml': request(false).replace('WP-T-demo', 'WP-T-other'),
      },
    });
    expect(of(dup, 'R-ID').some((f) => f.message.includes('already requested'))).toBe(true);
  });
});
