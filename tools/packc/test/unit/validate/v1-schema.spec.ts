// UT-PACKC-016~029 — V1 zod 스키마(DCP-01 §6 파일 스키마 12종 · Brief T-01-03 §4.2-a 템플릿).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../../src/parse/discover.js';
import { loadFile } from '../../../src/parse/load.js';
import { Item } from '../../../src/parse/schema/item.js';
import { ItemModel } from '../../../src/parse/schema/item-model.js';
import { V1_SCHEMAS, validateV1 } from '../../../src/validate/v1-schema.js';
import { FIXTURES, REPO_POLICY } from '../cli/helpers.js';

const BASE = join(FIXTURES, 'base/content');

function raw(rel: string): { disc: ReturnType<typeof discFile>; data: unknown; body: string | null } {
  const disc = discFile(rel);
  const r = loadFile(BASE, disc);
  if (r.raw === null) {
    throw new Error(`cannot load ${rel}: ${r.findings[0]?.message ?? ''}`);
  }
  return { disc, data: r.raw.data, body: r.raw.body };
}

function discFile(rel: string) {
  const d = classify(rel);
  if (d === null || d.type !== 'file') {
    throw new Error(`not a file kind: ${rel}`);
  }
  return d;
}

function clone(v: unknown): Record<string, unknown> {
  const c: unknown = JSON.parse(JSON.stringify(v));
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    throw new Error('expected an object');
  }
  const out: Record<string, unknown> = {};
  Object.assign(out, c);
  return out;
}

const ctx = { policyDir: REPO_POLICY };

function check(rel: string, mutate?: (d: Record<string, unknown>) => void) {
  const r = raw(rel);
  const data = clone(r.data);
  mutate?.(data);
  return validateV1({ disc: r.disc, data, body: r.body }, ctx);
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 같은 객체 참조를 돌려준다(변형이 원본에 반영돼야 한다). */
function rec(v: unknown): Record<string, unknown> {
  if (!isRec(v)) {
    throw new Error('expected an object');
  }
  return v;
}

const CONCEPT = 'packs/k8s/concepts/k8s.probes.md';
const KUS = 'packs/k8s/kus/k8s.probes.yaml';
const MCS = 'packs/k8s/misconceptions/k8s.probes.yaml';
const ITEMS = 'packs/k8s/items/k8s.probes.yaml';
const MODELS = 'packs/docker/item-models/docker.dockerfile.yaml';

describe('UT-PACKC-016 pack.yaml [FR-CUR-003]', () => {
  it('UT-PACKC-016 a valid pack passes; id, track.id, requires.packc range and policy files are checked [FR-CUR-003]', () => {
    expect(check('packs/docker/pack.yaml').file?.kind).toBe('pack');
    expect(check('packs/docker/pack.yaml', (d) => (d.id = 'k8s')).findings.some((f) => f.keypath === 'id')).toBe(true);
    expect(
      check('packs/docker/pack.yaml', (d) => (rec(d.track).id = 'k8s')).findings.some((f) => f.keypath === 'track.id'),
    ).toBe(true);
    expect(
      check('packs/docker/pack.yaml', (d) => (rec(d.requires).packc = '>=1.0.0 <2.0.0')).findings.some(
        (f) => f.keypath === 'requires.packc',
      ),
    ).toBe(true);
    expect(
      check('packs/docker/pack.yaml', (d) => (rec(d.requires).packc = 'latest')).findings.some(
        (f) => f.keypath === 'requires.packc',
      ),
    ).toBe(true);
    expect(
      check('packs/docker/pack.yaml', (d) => (rec(rec(d.requires).policy).mastery_rules = 'v9')).findings.some(
        (f) => f.keypath === 'requires.policy.mastery_rules',
      ),
    ).toBe(true);
    expect(check('packs/docker/pack.yaml', (d) => (d.version = '1.0')).file).toBeNull();
    expect(check('packs/docker/pack.yaml', (d) => (d.channel = 'user')).file).toBeNull();
  });
});

describe('UT-PACKC-017 concept frontmatter [FR-CUR-003]', () => {
  it('UT-PACKC-017 a valid concept passes; bad level, tier, id and dates fail [FR-CUR-003]', () => {
    const ok = check(CONCEPT);
    expect(ok.findings).toEqual([]);
    expect(ok.file?.kind).toBe('concept');
    expect(check(CONCEPT, (d) => (d.level = 6)).file).toBeNull();
    expect(check(CONCEPT, (d) => (d.tier = 'D')).file).toBeNull();
    expect(check(CONCEPT, (d) => (d.id = 'k8s')).file).toBeNull();
    expect(check(CONCEPT, (d) => (rec(d.review).valid_as_of = '2026-02-30')).file).toBeNull();
    expect(check(CONCEPT, (d) => delete d.title).file).toBeNull();
    expect(check(CONCEPT, (d) => (d.tags = ['bad tag'])).file).toBeNull();
  });

  it('UT-PACKC-017 source refs need quote if and only if usage is short_quote [FR-CUR-003]', () => {
    const bad = check(CONCEPT, (d) => {
      const s = d.sources;
      if (Array.isArray(s)) {
        rec(s[0]).usage = 'short_quote';
      }
    });
    expect(bad.file).toBeNull();
  });
});

describe('UT-PACKC-018 kus [FR-CUR-003]', () => {
  it('UT-PACKC-018 valid kus pass; a ku without source_refs or with a bad key fails [FR-CUR-003]', () => {
    expect(check(KUS).findings).toEqual([]);
    expect(check(KUS, (d) => (rec(rec(d.kus).k01).source_refs = [])).file).toBeNull();
    expect(check(KUS, (d) => (rec(d.kus).kx = rec(d.kus).k01)).file).toBeNull();
    expect(check(KUS, (d) => (rec(rec(d.kus).k01).type = 'idea')).file).toBeNull();
    expect(check(KUS, (d) => (d.kus = {})).file).toBeNull();
  });
});

describe('UT-PACKC-019 misconceptions [FR-CUR-003]', () => {
  it('UT-PACKC-019 valid mcs pass; an open meta_family or empty refutes fails [FR-CUR-003]', () => {
    expect(check(MCS).findings).toEqual([]);
    expect(check(MCS, (d) => (rec(rec(d.mcs).m01).meta_family = 'mf_other')).file).toBeNull();
    expect(check(MCS, (d) => (rec(rec(d.mcs).m01).refutes = [])).file).toBeNull();
    expect(check(MCS, (d) => (rec(rec(d.mcs).m01).prevalence = 'huge')).file).toBeNull();
  });
});

const code = { lang: 'ts', src: 'const a = 1;' };
const common = {
  facet: 'definition',
  response_mode: 'recognition',
  level: 1,
  bloom: 'understand',
  ku_refs: ['k01'],
  stem_family: 'sf_demo',
  gate_status: 'authored',
  explanation_md: 'x'.repeat(30),
};
const s10 = 'x'.repeat(12);
/** 22개 저작 형식(items 파일에 쓰는 것) 각 1개의 최소 유효 문항 + 대표 오류. */
const SAMPLES: Record<string, { ok: Record<string, unknown>; bad: Record<string, unknown> }> = {
  ox: { ok: { stem: s10, answer: true, correction_md: s10 }, bad: { stem: s10, answer: false, correction_md: s10 } },
  mcq: {
    ok: { stem: s10, options: { opt_a: 'a', opt_b: 'b', opt_c: 'c' }, answer: 'opt_a' },
    bad: { stem: s10, options: { opt_a: 'a' }, answer: 'a' },
  },
  mcq_multi: {
    ok: { stem: s10, options: { opt_a: 'a', opt_b: 'b' }, answer: { opt_a: true } },
    bad: { stem: s10, options: { opt_a: 'a' }, answer: { opt_a: false } },
  },
  cloze: {
    ok: { stem: `${s10} {{b1}}`, blanks: { b1: { accept: ['x'] } } },
    bad: { stem: `${s10} {{b1}}`, blanks: { b1: { accept: [] } } },
  },
  short: { ok: { stem: s10, accept: ['x'] }, bad: { stem: s10, numeric: { value: 1, tol_rel: 0.9 } } },
  order: {
    ok: { stem: s10, steps: { s_a: 'aa', s_b: 'bb', s_c: 'cc' }, answer: ['s_a', 's_b', 's_c'] },
    bad: { stem: s10, steps: { s_a: 'aa' }, answer: ['s_a'] },
  },
  matching: {
    ok: { stem: s10, left: { l_a: 'a' }, right: { r_a: 'a' }, answer: { l_a: 'r_a' } },
    bad: { stem: s10, left: { l_a: 'a' }, right: { r_a: 'a' } },
  },
  code_predict: {
    ok: { stem: s10, code: { lang: 'js', src: 'x' }, answer: 'auto' },
    bad: { stem: s10, code: { lang: 'sql2', src: 'x' }, answer: 'auto' },
  },
  error_find: {
    ok: { stem: s10, code, answer: { from: 1, to: 2 } },
    bad: { stem: s10, code, answer: { from: 0, to: 2 } },
  },
  parsons: {
    ok: { stem: s10, lang: 'ts', lines: { ln_a: 'a' }, answer: ['ln_a', 'ln_b', 'ln_c'] },
    bad: { stem: s10, lang: 'ts', lines: { ln_a: 'a' }, answer: ['ln_a'] },
  },
  config_review: {
    ok: {
      stem: s10,
      artifact: { lang: 'yaml', src: 'a: 1' },
      defect_manifest: { df_a: { from: 1, to: 1, rule: 'r', severity: 'high', note: 'note-note' } },
    },
    bad: { stem: s10, artifact: { lang: 'yaml', src: 'a: 1' } },
  },
  log_read: {
    ok: { stem: s10, log: code, options: { opt_a: 'a' }, answer: 'opt_a' },
    bad: { stem: s10, log: code, options: { opt_a: 'a' }, answer: 'x' },
  },
  cond_reversal: {
    ok: {
      scenario: 'x'.repeat(24),
      conditions: { cond_a: s10, cond_b: s10 },
      options: { opt_a: 'a', opt_b: 'b' },
      answer: { cond_a: 'opt_a', cond_b: 'opt_b' },
      pivot_md: s10,
    },
    bad: { scenario: 'x', conditions: { cond_a: s10, cond_b: s10 }, options: {}, answer: {}, pivot_md: s10 },
  },
  fermi: {
    ok: { stem: 'x'.repeat(24), answer: { value: 5, unit: 'ms' } },
    bad: { stem: 'x'.repeat(24), answer: { value: -5, unit: 'ms' } },
  },
  blank_note: {
    ok: {
      prompt: s10,
      idea_units: { iu_a: { text: 't', ku_ref: 'k01', keywords: ['a'] } },
      model_note_md: 'x'.repeat(60),
    },
    bad: { prompt: s10, idea_units: {}, model_note_md: 'short' },
  },
  essay: {
    ok: {
      prompt: s10,
      key_points: { kp_a: { text: 't', ku_ref: 'k01' } },
      rubric: 'rb.x',
      model_answer_md: 'x'.repeat(60),
    },
    bad: { prompt: s10, key_points: {}, model_answer_md: 'x'.repeat(60) },
  },
  digging: {
    ok: { depth: 'd1', question: s10, expects: { kp_a: { text: 't', ku_ref: 'k01' } } },
    bad: { depth: 'd9', question: s10, expects: {} },
  },
  digging_d4_mcq: {
    ok: { depth: 'd4', stem: s10, options: { opt_a: 'a' }, answer: 'opt_a' },
    bad: { depth: 'd1', stem: s10, options: { opt_a: 'a' }, answer: 'opt_a' },
  },
  feynman: {
    ok: {
      student_persona: s10,
      student_beliefs: { sb_a: { mc_ref: 'm01', opening_line: s10 } },
      checklist: { ck_a: { text: 't', ku_ref: 'k01' } },
    },
    bad: { student_persona: s10, student_beliefs: { sb_a: { mc_ref: 'x', opening_line: s10 } }, checklist: {} },
  },
  audit: {
    ok: {
      prompt: s10,
      artifact_md: 'x'.repeat(120),
      defect_manifest: { df_a: { quote: 'q', kind: 'factual', correction: 'fixed-it' } },
    },
    bad: { prompt: s10, artifact_md: 'x', defect_manifest: {} },
  },
  pr_review: {
    ok: {
      prompt: s10,
      diff: { lang: 'diff', src: '+a' },
      defect_manifest: { df_a: { file: 'a.ts', from: 1, to: 1, kind: 'security_weakness', note: 'note-note' } },
    },
    bad: { prompt: s10, diff: { lang: 'ts', src: '+a' }, defect_manifest: {} },
  },
  embedded: {
    ok: { shape: 'ox', stem: s10, answer: true },
    bad: { shape: 'tf', stem: s10, answer: true },
  },
};

describe('UT-PACKC-020~022 items [FR-CUR-003]', () => {
  const formats = Object.keys(SAMPLES);
  it('UT-PACKC-020 the Item union covers the 22 items-file formats; lab formats are not item formats [FR-CUR-003]', () => {
    expect(formats).toHaveLength(22);
    for (const lab of ['code_task', 'sql_task', 'infra_lite']) {
      expect(Item.safeParse({ format: lab, ...common, stem: s10 }).success, lab).toBe(false);
    }
  });

  for (const [i, f] of formats.entries()) {
    const id = i < 8 ? 'UT-PACKC-020' : i < 16 ? 'UT-PACKC-021' : 'UT-PACKC-022';
    it(`${id} format ${f}: one valid item passes and a representative error fails [FR-CUR-003]`, () => {
      const sample = SAMPLES[f];
      expect(sample).toBeDefined();
      if (sample === undefined) {
        return;
      }
      const ok = Item.safeParse({ format: f, ...common, ...sample.ok });
      expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
      expect(Item.safeParse({ format: f, ...common, ...sample.bad }).success).toBe(false);
      expect(Item.safeParse({ format: f, ...common, ...sample.ok, surprise: 1 }).success).toBe(false);
      expect(Item.safeParse({ format: f, ...common, ...sample.ok, gate_status: 'seed_reviewed' }).success).toBe(false);
    });
  }

  it('UT-PACKC-022 the sample items file passes V1 and an unsupported format is reported once [FR-CUR-003]', () => {
    expect(check(ITEMS).findings).toEqual([]);
    expect(check(ITEMS, (d) => (rec(rec(d.items).i01).format = 'code_task')).file).toBeNull();
  });
});

describe('UT-PACKC-023 item-models [FR-CUR-003]', () => {
  it('UT-PACKC-023 t1 binding passes; t2 template needs constraints and a closed format list [FR-CUR-003]', () => {
    expect(check(MODELS).findings).toEqual([]);
    expect(check(MODELS, (d) => (rec(rec(d.models).im01).generator = 't1.nope')).file).toBeNull();
    const t2 = {
      kind: 't2',
      format: 'cloze',
      facet: 'definition',
      response_mode: 'production',
      stem_family: 'sf_demo',
      source: { from: 'ku' },
      template: { stem: '{{ku.cloze}}', answer: '{{ku.cloze}}' },
      constraints: {},
      metamorphic: {},
      stakes_max: 'S1',
    };
    expect(ItemModel.safeParse(t2).success).toBe(true);
    expect(ItemModel.safeParse({ ...t2, format: 'essay' }).success).toBe(false);
    expect(ItemModel.safeParse({ ...t2, stakes_max: 'S2' }).success).toBe(false);
  });
});

describe('UT-PACKC-024 templates [FR-CUR-003]', () => {
  it('UT-PACKC-024 t2 and dig templates pass; ids and depths are checked [FR-CUR-003]', () => {
    expect(check('templates/t2/ku-cloze.yaml').findings).toEqual([]);
    expect(check('templates/dig/generic-01.yaml').findings).toEqual([]);
    expect(check('templates/t2/ku-cloze.yaml', (d) => (d.id = 'Bad_Id')).file).toBeNull();
    expect(check('templates/t2/ku-cloze.yaml', (d) => delete d.applies_to).file).toBeNull();
    expect(check('templates/dig/generic-01.yaml', (d) => (d.id = 'generic-10')).file).toBeNull();
    expect(check('templates/dig/generic-01.yaml', (d) => (d.depth = 'd8')).file).toBeNull();
    expect(check('templates/dig/generic-01.yaml', (d) => (d.expects_from = [])).file).toBeNull();
  });
});

describe('UT-PACKC-025 rubric [FR-CUR-003]', () => {
  it('UT-PACKC-025 a rubric passes; weights and levels are bounded [FR-CUR-003]', () => {
    expect(check('templates/rubrics/solo-5.yaml').findings).toEqual([]);
    expect(check('templates/rubrics/solo-5.yaml', (d) => (rec(rec(d.dims).d_accuracy).weight = 3)).file).toBeNull();
    expect(
      check('templates/rubrics/solo-5.yaml', (d) => (rec(rec(rec(d.dims).d_accuracy).levels).l4 = 'short')).file,
    ).toBeNull();
    expect(check('templates/rubrics/solo-5.yaml', (d) => (d.id = 'solo-5')).file).toBeNull();
    expect(check('templates/rubrics/solo-5.yaml', (d) => (rec(d.dims).bad = rec(d.dims).d_accuracy)).file).toBeNull();
  });
});

describe('UT-PACKC-026 sources [FR-CUR-003][FR-CUR-012]', () => {
  it('UT-PACKC-026 the registry passes; requests need wp, reason and merged [FR-CUR-003]', () => {
    expect(check('sources/registry.yaml').findings).toEqual([]);
    expect(
      check('sources/registry.yaml', (d) => (rec(rec(rec(d.sources)['src.docker-docs']).license).grade = 'Z')).file,
    ).toBeNull();
    expect(
      check('sources/registry.yaml', (d) => (rec(rec(d.sources)['src.docker-docs']).base_url = 'http://x.y')).file,
    ).toBeNull();
    const registry = raw('sources/registry.yaml');
    const entry = rec(rec(clone(registry.data).sources)['src.docker-docs']);
    const request = (patch: Record<string, unknown>) =>
      validateV1(
        {
          disc: discFile('sources/requests/WP-T-demo.yaml'),
          data: {
            schema_v: 1,
            wp: 'WP-T-demo',
            requests: { 'src.new-docs': { ...entry, reason: 'needed for demo', merged: false, ...patch } },
          },
          body: null,
        },
        ctx,
      );
    expect(request({}).findings).toEqual([]);
    expect(request({ merged: undefined }).file).toBeNull();
    expect(request({ reason: 'x' }).file).toBeNull();
  });
});

describe('UT-PACKC-027 V7 record [FR-CUR-003][FR-QST-011]', () => {
  it('UT-PACKC-027 the V7 record passes; batch id, hashes and reviewer are checked [FR-CUR-003]', () => {
    const rel = 'review/V7/docker/v7.docker.001.yaml';
    expect(check(rel).findings).toEqual([]);
    expect(check(rel, (d) => (d.batch_id = 'v7.docker')).file).toBeNull();
    expect(check(rel, (d) => (rec(d.approved_hashes)['docker.dockerfile.i01'] = 'abc')).file).toBeNull();
    expect(check(rel, (d) => (rec(d.reviewer).tier = 'lower')).file).toBeNull();
    expect(check(rel, (d) => (d.defect_rate = 2)).file).toBeNull();
  });
});

describe('UT-PACKC-028 .strict() [FR-CUR-003]', () => {
  const targets: readonly string[] = [
    'packs/docker/pack.yaml',
    CONCEPT,
    KUS,
    MCS,
    ITEMS,
    MODELS,
    'templates/t2/ku-cloze.yaml',
    'templates/dig/generic-01.yaml',
    'templates/rubrics/solo-5.yaml',
    'sources/registry.yaml',
    'review/V7/docker/v7.docker.001.yaml',
  ];
  it('UT-PACKC-028 an unknown key is a V1 error with the key in the keypath for every file kind [FR-CUR-003]', () => {
    for (const rel of targets) {
      const r = check(rel, (d) => (d.surprise_key = 1));
      expect(r.file, rel).toBeNull();
      expect(
        r.findings.some((f) => f.rule === 'V1' && f.keypath === 'surprise_key'),
        rel,
      ).toBe(true);
    }
  });

  it('UT-PACKC-028 an unknown nested key is reported with its full keypath [FR-CUR-003]', () => {
    const r = check(KUS, (d) => (rec(rec(d.kus).k01).surprise = 1));
    expect(r.findings.some((f) => f.keypath === 'kus.k01.surprise')).toBe(true);
    const files = readdirSync(join(BASE, 'packs/k8s'));
    expect(files).toContain('kus');
    expect(Object.keys(V1_SCHEMAS)).toHaveLength(12);
  });
});

describe('UT-PACKC-029 no schema redefinition (STD core 3) [FR-CUR-003]', () => {
  const dir = join(import.meta.dirname, '../../../src/parse/schema');
  const IF_TYPES = [
    'TrackId',
    'ConceptId',
    'KuId',
    'MisconceptionId',
    'ItemId',
    'ItemModelId',
    'SourceId',
    'RubricId',
    'CaseId',
    'LabId',
    'SemVer',
    'Sha256Hex',
    'Level',
    'Tier',
    'KnowledgeType',
    'Volatility',
    'Tag',
    'FormatId',
    'AiMode',
    'StudyDay',
    'BundleRecord',
    'FpackManifest',
    'PackKpi',
    'FeasibilityBlocker',
    'GateStatus',
  ];
  it('UT-PACKC-029 schema files import IF-01 types from @fathom/contracts and never redefine them [FR-CUR-003]', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(11);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const t of IF_TYPES) {
        expect(new RegExp(`export const ${t}\\b`).test(text), `${f} redefines ${t}`).toBe(false);
      }
    }
    const common = readFileSync(join(dir, 'common.ts'), 'utf8');
    expect(common).toContain('@fathom/contracts/common/ids');
    expect(readFileSync(join(dir, 'concept.ts'), 'utf8')).toContain('@fathom/contracts/common/domain');
    expect(readFileSync(join(dir, 'pack.ts'), 'utf8')).toContain('@fathom/contracts/common/ids');
  });
});
