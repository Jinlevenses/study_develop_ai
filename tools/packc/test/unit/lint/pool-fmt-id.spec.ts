// UT-PACKC-002·007·008 — R-POOL(structuralFeasibility 재사용) · R-FMT(형식 어휘) · R-ID(IF-01 ID 정규식).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FormatId } from '@fathom/contracts/common/domain';
import { ConceptId, ItemId, ItemModelId, KuId, MisconceptionId } from '@fathom/contracts/common/ids';
import { structuralFeasibility } from '@fathom/contracts/pack/feasibility';
import { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import { loadPolicy, parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORING_FORMATS, FORMAT_META, NON_AUTHORING_FORMATS } from '../../../src/format-map.js';
import { buildInventory, computeCap, eligible, MODES } from '../../../src/lint/inventory.js';
import { ruleFmt } from '../../../src/lint/rules/r-fmt.js';
import { runCheck } from '../../../src/lint/run.js';
import { splitFrontmatter } from '../../../src/parse/frontmatter.js';
import { loadPolicies } from '../../../src/validate/policy.js';
import {
  FIXTURES,
  lines,
  listCases,
  materialize,
  mutatedTree,
  PACKC_ROOT,
  REPO_POLICY,
  rmTmp,
  run,
  tmpRoot,
} from '../cli/helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});
function tree(m = {}) {
  const t = mutatedTree(m);
  roots.push(t.root);
  return t;
}
function checked(contentDir: string, release = false) {
  const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release });
  if (!r.ok) {
    throw new Error(r.error);
  }
  return r.value;
}

describe('UT-PACKC-002 R-POOL [FR-CUR-025][CR-10]', () => {
  it('UT-PACKC-002 the finding, report blockers and a direct structuralFeasibility call agree [FR-CUR-025]', () => {
    const { contentDir } = tree();
    const c = checked(contentDir);
    const concepts = c.ctx.model.concepts.filter((x) => x.disc.track === 'docker');
    const inv = buildInventory('docker', concepts, c.ctx.idx, c.ctx.method);
    const direct = structuralFeasibility(c.ctx.mastery, inv, { track: 'docker', from: 1, to: 2 }, 'OFFLINE', 'unknown');
    expect(direct.feasible).toBe(false);
    const cap = computeCap(c.ctx.mastery, inv);
    expect(cap.blockers.L1.OFFLINE).toEqual(direct.blockers);
    expect(cap.cap_blockers.slice(0, direct.blockers.length)).toEqual(direct.blockers);
    const pool = c.findings.filter((f) => f.rule === 'R-POOL' && f.file === 'packs/docker/pack.yaml');
    expect(pool).toHaveLength(1);
    expect(pool[0]?.message).toBe(
      `cap OFFLINE=L${cap.offline_cap_level} FULL=L${cap.oracle_cap_level}; L${cap.offline_cap_level}→L${cap.offline_cap_level + 1} OFFLINE: ${direct.blockers.map((b) => b.code).join(',')}`,
    );
    expect(pool[0]?.severity).toBe('warn');
    const transitions = [
      { key: 'L1', from: 1, to: 2 },
      { key: 'L2', from: 2, to: 3 },
      { key: 'L3', from: 3, to: 4 },
      { key: 'L4', from: 4, to: 5 },
    ] as const;
    for (const t of transitions) {
      for (const mode of MODES) {
        const r = structuralFeasibility(
          c.ctx.mastery,
          inv,
          { track: 'docker', from: t.from, to: t.to },
          mode,
          'unknown',
        );
        expect(cap.blockers[t.key][mode], `${t.key} ${mode}`).toEqual(r.blockers);
      }
    }
  });

  it('UT-PACKC-002 a thin pool is a warning (exit 0) and --release makes it an error (exit 1) [FR-CUR-025]', () => {
    const { contentDir } = tree();
    const warn = run(['check', '--content-dir', contentDir]);
    expect(warn.code).toBe(0);
    expect(lines(warn.stdout).filter((l) => l.startsWith('warn R-POOL'))).toHaveLength(2);
    const release = run(['check', '--content-dir', contentDir, '--release']);
    expect(release.code).toBe(1);
    expect(lines(release.stdout).filter((l) => l.startsWith('error R-POOL'))).toHaveLength(2);
    const fixture = listCases().find((x) => x.rule === 'r-pool' && x.name === 'release');
    expect(fixture?.spec.args).toEqual(['--release']);
  });

  it('UT-PACKC-002 deferred items are not counted and OFFLINE only counts D-class credit formats [FR-CUR-025]', () => {
    const { contentDir } = tree();
    const c = checked(contentDir);
    const docker = c.ctx.model.concepts.filter((x) => x.disc.track === 'docker');
    const inv = buildInventory('docker', docker, c.ctx.idx, c.ctx.method);
    const dockerfile = inv.concepts.find((x) => x.concept_id === 'docker.dockerfile');
    expect(dockerfile?.d4_possible).toBe(true);
    expect(dockerfile?.required_for_level).toBe(1);
    for (const f of dockerfile?.formats_by_mode.OFFLINE ?? []) {
      expect(c.ctx.method.formats[f]?.grade_class).toBe('D');
      expect(eligible(c.ctx.method, f, 'OFFLINE')).toBe(true);
    }
    expect(dockerfile?.formats_by_mode.OFFLINE).toEqual([...(dockerfile?.formats_by_mode.OFFLINE ?? [])].sort());
    const tierC = inv.concepts.find((x) => x.concept_id === 'docker.image-layer');
    expect(tierC?.required_for_level).toBeNull();
    expect(tierC?.formats_by_mode.FULL).toEqual([]);
    expect(inv.cases).toEqual([]);
    expect(inv.assessment_pool['1'].OFFLINE.items).toBe(9);
    expect(inv.assessment_pool['2'].FULL.items).toBe(0);
  });

  it('UT-PACKC-002 the source imports structuralFeasibility and holds no pool-threshold logic [FR-CUR-025][CR-10]', () => {
    const inv = readFileSync(join(PACKC_ROOT, 'src/lint/inventory.ts'), 'utf8');
    const rule = readFileSync(join(PACKC_ROOT, 'src/lint/rules/r-pool.ts'), 'utf8');
    expect(inv).toContain("import { structuralFeasibility } from '@fathom/contracts/pack/feasibility';");
    expect(rule).toContain('structuralFeasibility()');
    expect(`${inv}${rule}`).not.toMatch(/policy\.assessment|formats_min|assessment\.items/);
  });
});

describe('UT-PACKC-007 R-FMT [FR-STD-033][FR-QST-007]', () => {
  it('UT-PACKC-007 flashcard, case_decision and kata items are R-FMT errors [FR-STD-033]', () => {
    for (const name of ['unknown-flashcard', 'non-authoring-case-decision', 'non-authoring-kata']) {
      const c = listCases().find((x) => x.rule === 'r-fmt' && x.name === name);
      expect(c, name).toBeDefined();
      if (c === undefined) {
        continue;
      }
      const root = tmpRoot();
      roots.push(root);
      const dir = materialize(root, { ...c.spec, overlay: c.dir });
      const r = run(['check', '--content-dir', dir]);
      expect(r.code, name).toBe(1);
      const hit = lines(r.stdout).filter((l) => l.startsWith('error R-FMT'));
      expect(hit).toHaveLength(1);
      expect(hit[0]).toContain('packs/k8s/items/k8s.probes.yaml#items.i01.format');
    }
  });

  it('UT-PACKC-007 AUTHORING (25) and NON_AUTHORING (8) partition the 33 FormatId values [FR-STD-033]', () => {
    expect(AUTHORING_FORMATS).toHaveLength(25);
    expect(NON_AUTHORING_FORMATS).toHaveLength(8);
    const all = new Set<string>([...AUTHORING_FORMATS, ...NON_AUTHORING_FORMATS]);
    expect(all.size).toBe(33);
    expect([...all].sort()).toEqual([...FormatId.options].sort());
    expect(AUTHORING_FORMATS.filter((f) => (NON_AUTHORING_FORMATS as readonly string[]).includes(f))).toEqual([]);
    expect(Object.keys(FORMAT_META).sort()).toEqual([...AUTHORING_FORMATS].sort());
    expect(FORMAT_META.mcq).toEqual({ response_mode: 'recognition', n_options: { min: 3, max: 5 }, tiers: ['A', 'B'] });
    expect(FORMAT_META.cloze.response_mode).toBe('production');
  });

  it('UT-PACKC-007 the repository method_policy@v1 formats keys are exactly the 33 FormatId values [FR-QST-007]', () => {
    const text = readFileSync(join(REPO_POLICY, 'method_policy@v1.yaml'), 'utf8');
    const parsed = parseYamlStrict(text);
    expect(parsed.ok).toBe(true);
    const loaded = loadPolicy('method_policy', 1, { policyDir: REPO_POLICY, schema: MethodPolicyV1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(Object.keys(loaded.value.value.formats).sort()).toEqual([...FormatId.options].sort());
    const { contentDir } = tree();
    const c = checked(contentDir);
    expect(c.findings.filter((f) => f.rule === 'R-FMT')).toEqual([]);
  });

  it('UT-PACKC-007 a method policy whose formats differ from FormatId is an R-FMT error on the policy file [FR-STD-033]', () => {
    const { contentDir } = tree();
    const c = checked(contentDir);
    const entries = Object.entries(c.ctx.method.formats);
    const template = entries[0]?.[1];
    expect(template).toBeDefined();
    const method = MethodPolicyV1.parse({ ...c.ctx.method });
    const broken = { ...method, formats: Object.fromEntries([...entries.slice(1), ['flashcard', template]]) };
    const out = ruleFmt({ ...c.ctx, method: broken as unknown as typeof c.ctx.method });
    expect(out.map((f) => f.rule)).toEqual(['R-FMT', 'R-FMT']);
    expect(out[0]?.file).toBe('policy/method_policy@v1.yaml');
    expect(out.map((f) => f.message).join(' ')).toContain('missing formats');
    expect(out.map((f) => f.message).join(' ')).toContain('unknown formats: flashcard');
    const policies = loadPolicies(REPO_POLICY);
    expect(policies.ok).toBe(true);
  });
});

describe('UT-PACKC-008 R-ID against IF-01 patterns [FR-CUR-004][FR-CUR-013]', () => {
  it('UT-PACKC-008 the DCP section 13 samples (docker.dockerfile, sre.reliability-strategy) pass IF common/ids [FR-CUR-004]', () => {
    const dcp = readFileSync(join(PACKC_ROOT, '../../docs/02-design/04-data-collection-plan.md'), 'utf8').split('\n');
    const start = dcp.findIndex((l) => l.startsWith('### 13.5'));
    const end = dcp.findIndex((l) => l.startsWith('## 14.'));
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const blocks: string[] = [];
    let cur: string[] | null = null;
    for (const l of dcp.slice(start, end)) {
      if (l.startsWith('~~~~') && cur === null) {
        cur = [];
      } else if (l === '~~~~' && cur !== null) {
        blocks.push(cur.join('\n'));
        cur = null;
      } else if (cur !== null) {
        cur.push(l);
      }
    }
    expect(blocks.length).toBe(4);
    const [concept = '', kus = '', mcs = '', items = ''] = blocks;
    const fm = splitFrontmatter(concept);
    expect(fm.ok).toBe(true);
    const id = /^id: (\S+)$/m.exec(fm.ok ? fm.value.yaml : '')?.[1] ?? '';
    expect(id).toBe('sre.reliability-strategy');
    expect(ConceptId.safeParse(id).success).toBe(true);
    const keys = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1] ?? '');
    const kuKeys = keys(kus, /^ {2}(k\d{2}):/gm);
    const mcKeys = keys(mcs, /^ {2}(m\d{2}):/gm);
    const itemKeys = keys(items, /^ {2}(i\d{2,3}):/gm);
    expect(kuKeys.length).toBeGreaterThan(5);
    expect(mcKeys.length).toBeGreaterThan(2);
    expect(itemKeys.length).toBeGreaterThan(10);
    for (const k of kuKeys) {
      expect(KuId.safeParse(`${id}.${k}`).success, k).toBe(true);
    }
    for (const k of mcKeys) {
      expect(MisconceptionId.safeParse(`${id}.${k}`).success, k).toBe(true);
    }
    for (const k of itemKeys) {
      expect(ItemId.safeParse(`${id}.${k}`).success, k).toBe(true);
    }
    // docker.dockerfile 견본(fixture 사본)
    const dockerfile = readFileSync(join(FIXTURES, 'base/content/packs/docker/concepts/docker.dockerfile.md'), 'utf8');
    expect(/^id: docker\.dockerfile$/m.test(dockerfile)).toBe(true);
    expect(ConceptId.safeParse('docker.dockerfile').success).toBe(true);
    expect(ItemModelId.safeParse('docker.dockerfile.im01').success).toBe(true);
    expect(/^volatility: evolving$/m.test(dockerfile)).toBe(true);
    const { contentDir } = tree();
    expect(checked(contentDir).findings.filter((f) => f.rule === 'R-ID')).toEqual([]);
  });

  it('UT-PACKC-008 every scaffolded concept and its derived ids pass the IF patterns [FR-CUR-004]', () => {
    const root = tmpRoot();
    roots.push(root);
    const r = run(['scaffold', '--content-dir', join(root, 'content'), '--as-of', '2026-10-02']);
    expect(r.code).toBe(0);
    const ids: string[] = [];
    const base = join(root, 'content/packs');
    for (const t of readdirSync(base)) {
      for (const f of readdirSync(join(base, t, 'concepts'))) {
        ids.push(f.replace(/\.md$/, ''));
      }
    }
    expect(ids).toHaveLength(469);
    for (const id of ids) {
      expect(ConceptId.safeParse(id).success, id).toBe(true);
      expect(KuId.safeParse(`${id}.k01`).success, id).toBe(true);
      expect(MisconceptionId.safeParse(`${id}.m01`).success, id).toBe(true);
      expect(ItemId.safeParse(`${id}.i01`).success, id).toBe(true);
      expect(ItemModelId.safeParse(`${id}.im01`).success, id).toBe(true);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });

  it('UT-PACKC-008 file name, reserved slug, cross-pack duplicates and orphan files are R-ID errors [FR-CUR-004]', () => {
    for (const name of ['file-mismatch', 'slug-reserved', 'duplicate-across-packs', 'orphan-kus']) {
      const c = listCases().find((x) => x.rule === 'r-id' && x.name === name);
      expect(c, name).toBeDefined();
      if (c === undefined) {
        continue;
      }
      const root = tmpRoot();
      roots.push(root);
      const dir = materialize(root, { ...c.spec, overlay: c.dir });
      const r = run(['check', '--content-dir', dir]);
      expect(r.code, name).toBe(1);
      expect(r.stdout, name).toContain('error R-ID');
    }
  });
});
