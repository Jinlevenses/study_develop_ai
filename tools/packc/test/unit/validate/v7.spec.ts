// UT-PACKC-045~049 — V7 바인딩·문항 상태·det-ULID·hashes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ulid } from '@fathom/contracts/common/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { prepare } from '../../../src/emit/build.js';
import { dayToEpochMs } from '../../../src/emit/det-ulid.js';
import { runCheck } from '../../../src/lint/run.js';
import type { Mutation } from '../cli/helpers.js';
import { FIXTURES, lines, mutatedTree, REPO_POLICY, rmTmp, run } from '../cli/helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});

const V7 = 'content/review/V7/docker/v7.docker.001.yaml';
const DITEMS = 'content/packs/docker/items/docker.dockerfile.yaml';
const v7Text = readFileSync(join(FIXTURES, 'base/content/review/V7/docker/v7.docker.001.yaml'), 'utf8');

function bind(m: Mutation = {}) {
  const { root, contentDir } = mutatedTree(m);
  roots.push(root);
  const r = runCheck({ contentDir, policyDir: REPO_POLICY, packs: null, only: null, release: false });
  if (!r.ok) {
    throw new Error(r.error);
  }
  const errors = r.value.findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`fixture errors: ${errors.map((f) => `${f.rule} ${f.keypath} ${f.message}`).join('|')}`);
  }
  return { ...prepare(r.value.ctx, 'docker'), findings: r.value.findings, contentDir };
}

function statusOf(m: Mutation, id: string): string | undefined {
  const r = bind(m).records.records.find((x) => x.kind === 'item' && x.item_id === id);
  return r?.kind === 'item' ? r.gate_status : undefined;
}

const I01 = 'docker.dockerfile.i01';

describe('UT-PACKC-045 approval [FR-QST-011][FR-CUR-002]', () => {
  it('UT-PACKC-045 an approved batch with matching hashes gives seed_reviewed + a V7 GateResultRecord [FR-QST-011]', () => {
    const b = bind();
    const item = b.records.records.find((x) => x.kind === 'item' && x.item_id === I01);
    expect(item?.kind === 'item' && item.gate_status).toBe('seed_reviewed');
    expect(item?.kind === 'item' && item.s2_mode).toBe('v7_review');
    const gates = b.records.records.flatMap((x) => (x.kind === 'gate_result' ? [x] : []));
    expect(gates.map((g) => g.subject_id)).toEqual(
      ['i01', 'i02', 'i03', 'i04', 'i05', 'i06'].map((n) => `docker.dockerfile.${n}`),
    );
    const g = gates[0];
    expect(g).toMatchObject({
      subject_kind: 'item',
      gate: 'V7',
      engine: 'USER',
      provider_id: null,
      run_context: 'seed_build',
      pass: true,
      score: null,
      probabilities: null,
      detail: { batch_id: 'v7.docker.001', policy: 'tier_a_20pct', defect_rate: 0 },
    });
    expect(g?.content_hash).toBe(item?.kind === 'item' ? item.content_hash : '');
    expect(Ulid.safeParse(g?.gate_result_id).success).toBe(true);
    expect(b.binding.stale).toEqual([]);
    expect(b.binding.counts).toEqual({ authored: 16, seed_reviewed: 6, deferred: 0 });
  });

  it('UT-PACKC-045 the det-ULID is deterministic and its time part is the batch day at 00:00 UTC [FR-QST-011]', () => {
    const a = bind().records.records.flatMap((x) => (x.kind === 'gate_result' ? [x.gate_result_id] : []));
    const b = bind().records.records.flatMap((x) => (x.kind === 'gate_result' ? [x.gate_result_id] : []));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = 0n;
    for (const ch of (a[0] ?? '').slice(0, 10)) {
      time = time * 32n + BigInt(crockford.indexOf(ch));
    }
    expect(Number(time)).toBe(dayToEpochMs('2026-10-01'));
  });
});

describe('UT-PACKC-046 hash mismatch [FR-QST-011]', () => {
  it('UT-PACKC-046 changing a reviewed item makes it authored, stale, and reports an info finding [FR-QST-011]', () => {
    expect(bind().binding.stale).toEqual([]);
    const changed = bind({
      replace: [
        { file: DITEMS, from: '  i01:\n    format: ox\n', to: '  i01:\n    format: ox\n    tags: ["qa:security"]\n' },
      ],
    });
    expect(changed.binding.stale).toEqual([I01]);
    const item = changed.records.records.find((x) => x.kind === 'item' && x.item_id === I01);
    expect(item?.kind === 'item' && item.gate_status).toBe('authored');
    expect(item?.kind === 'item' && item.s2_mode).toBeNull();
    expect(changed.binding.counts.seed_reviewed).toBe(5);
    const info = changed.binding.findings.filter((f) => f.rule === 'V7');
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({ severity: 'info', file: 'review/V7/docker/v7.docker.001.yaml' });
    expect(info[0]?.message).toContain('hash does not match');
    expect(changed.records.records.some((x) => x.kind === 'gate_result' && x.subject_id === I01)).toBe(false);
  });

  it('UT-PACKC-046 stale ids are info findings in check and never errors [FR-QST-011]', () => {
    const { root, contentDir } = mutatedTree({
      replace: [
        { file: DITEMS, from: '  i01:\n    format: ox\n', to: '  i01:\n    format: ox\n    tags: ["qa:security"]\n' },
      ],
    });
    roots.push(root);
    const r = run(['check', '--content-dir', contentDir]);
    expect(r.code).toBe(0);
    expect(lines(r.stdout).some((l) => l.startsWith('info V7 review/V7/docker/v7.docker.001.yaml'))).toBe(true);
  });

  it('UT-PACKC-046 an item missing from approved_hashes is stale too [FR-QST-011]', () => {
    const line = v7Text.split('\n').find((l) => l.startsWith('  docker.dockerfile.i03:')) ?? '';
    const b = bind({ replace: [{ file: V7, from: `${line}\n`, to: '' }] });
    expect(b.binding.stale).toEqual(['docker.dockerfile.i03']);
  });
});

describe('UT-PACKC-047 batch selection and conditions [FR-QST-011]', () => {
  const rework = v7Text
    .replace('batch_id: v7.docker.001', 'batch_id: v7.docker.002')
    .replace('decision: approve', 'decision: rework');

  it('UT-PACKC-047 the latest created_at wins; a later rework batch makes the item authored [FR-QST-011]', () => {
    const later = rework.replace('created_at: "2026-10-01"', 'created_at: "2026-10-02"');
    expect(statusOf({ write: { 'content/review/V7/docker/v7.docker.002.yaml': later } }, I01)).toBe('authored');
    const earlier = rework.replace('created_at: "2026-10-01"', 'created_at: "2026-09-30"');
    expect(statusOf({ write: { 'content/review/V7/docker/v7.docker.002.yaml': earlier } }, I01)).toBe('seed_reviewed');
  });

  it('UT-PACKC-047 on equal created_at the larger batch_id wins [FR-QST-011]', () => {
    expect(statusOf({ write: { 'content/review/V7/docker/v7.docker.002.yaml': rework } }, I01)).toBe('authored');
    const lower = v7Text.replace('batch_id: v7.docker.001', 'batch_id: v7.docker.000');
    const m: Mutation = {
      write: { 'content/review/V7/docker/v7.docker.000.yaml': lower.replace('decision: approve', 'decision: rework') },
    };
    expect(statusOf(m, I01)).toBe('seed_reviewed');
  });

  it('UT-PACKC-047 same context_id, defect_rate above 5 percent and unresolved blockers keep items authored [FR-QST-011]', () => {
    expect(
      statusOf({ replace: [{ file: V7, from: 'context_id: ctx-review-001', to: 'context_id: ctx-author-001' }] }, I01),
    ).toBe('authored');
    expect(statusOf({ replace: [{ file: V7, from: 'defect_rate: 0', to: 'defect_rate: 0.06' }] }, I01)).toBe(
      'authored',
    );
    expect(statusOf({ replace: [{ file: V7, from: 'defect_rate: 0', to: 'defect_rate: 0.05' }] }, I01)).toBe(
      'seed_reviewed',
    );
    const finding = (resolution: string): Mutation => ({
      replace: [
        {
          file: V7,
          from: 'findings: {}',
          to: `findings:\n  f_01: { record_id: ${I01}, severity: blocker, category: key, note: "정답이 모호하다", resolution: ${resolution} }`,
        },
      ],
    });
    expect(statusOf(finding('deferred'), I01)).toBe('authored');
    expect(statusOf(finding('wont_fix'), I01)).toBe('authored');
    expect(statusOf(finding('fixed'), I01)).toBe('seed_reviewed');
    const major = {
      replace: [
        {
          file: V7,
          from: 'findings: {}',
          to: `findings:\n  f_01: { record_id: ${I01}, severity: major, category: key, note: "표현이 어색하다", resolution: deferred }`,
        },
      ],
    };
    expect(statusOf(major, I01)).toBe('seed_reviewed');
  });

  it('UT-PACKC-047 items outside every batch scope stay authored without being stale [FR-QST-011]', () => {
    const b = bind();
    const other = b.records.records.find((x) => x.kind === 'item' && x.item_id === 'docker.dockerfile.i10');
    expect(other?.kind === 'item' && other.gate_status).toBe('authored');
    expect(b.binding.stale).not.toContain('docker.dockerfile.i10');
  });
});

describe('UT-PACKC-048 deferred items [FR-QST-011]', () => {
  it('UT-PACKC-048 code_predict answer auto is deferred even when a batch approves it [FR-QST-011]', () => {
    const auto = `  i23:
    format: code_predict
    facet: code
    response_mode: production
    level: 1
    bloom: apply
    ku_refs: [k03]
    stem_family: sf_extra_predict
    gate_status: authored
    explanation_md: "console.log는 인자를 공백으로 이어 한 줄에 출력한다."
    stem: "다음 코드의 출력을 쓰시오."
    code: { lang: js, src: "console.log('RUN', 'CMD');" }
    answer: auto
`;
    const approved = v7Text
      .replace('    - docker.dockerfile.i06\n', '    - docker.dockerfile.i06\n    - docker.dockerfile.i23\n')
      .replace(/approved_hashes:\n/, `approved_hashes:\n  docker.dockerfile.i23: "${'a'.repeat(64)}"\n`);
    const b = bind({ append: { [DITEMS]: auto }, write: { [V7]: approved } });
    const item = b.records.records.find((x) => x.kind === 'item' && x.item_id === 'docker.dockerfile.i23');
    expect(item?.kind === 'item' && item.gate_status).toBe('deferred');
    expect(item?.kind === 'item' && item.answer_key).toEqual({ auto: true });
    expect(b.binding.counts.deferred).toBe(1);
    expect(b.records.records.some((x) => x.kind === 'gate_result' && x.subject_id === 'docker.dockerfile.i23')).toBe(
      false,
    );
    expect(b.binding.stale).not.toContain('docker.dockerfile.i23');
  });
});

describe('UT-PACKC-049 hashes [FR-QST-011][FR-CUR-002]', () => {
  it('UT-PACKC-049 hashes prints sorted subject hashes that do not depend on gate_status [FR-QST-011]', () => {
    const a = mutatedTree();
    roots.push(a.root);
    const ra = run(['hashes', '--pack', 'docker', '--content-dir', a.contentDir]);
    expect(ra.code).toBe(0);
    expect(ra.stderr).toBe('');
    const withV7: Record<string, string> = JSON.parse(ra.stdout);
    const keys = Object.keys(withV7);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('docker.dockerfile');
    expect(keys).toContain('docker.dockerfile.k01');
    expect(keys).toContain('docker.dockerfile.m01');
    expect(keys).toContain('docker.dockerfile.im01');
    expect(keys).toContain(I01);
    expect(keys.filter((k) => /\.i\d\d$/.test(k))).toHaveLength(22);
    expect(ra.stdout.endsWith('\n')).toBe(true);
    // V7 승인이 hashes를 바꾸지 않는다: 같은 값이 approved_hashes와 일치한다.
    const approved = [...v7Text.matchAll(/^ {2}(docker\.dockerfile\.i\d\d): "([0-9a-f]{64})"$/gm)];
    expect(approved).toHaveLength(6);
    for (const m of approved) {
      expect(withV7[m[1] ?? '']).toBe(m[2]);
    }
    const b = mutatedTree({ delete: [V7] });
    roots.push(b.root);
    const rb = run(['hashes', '--pack', 'docker', '--content-dir', b.contentDir]);
    expect(rb.stdout).toBe(ra.stdout);
  });

  it('UT-PACKC-049 hashes exits 1 with no output on V1/V2 errors and 2 on a bad pack argument [FR-QST-011]', () => {
    const t = mutatedTree({
      replace: [
        {
          file: 'content/packs/k8s/concepts/k8s.probes.md',
          from: 'required_for_level: 2',
          to: 'required_for_level: null',
        },
      ],
    });
    roots.push(t.root);
    const r = run(['hashes', '--pack', 'k8s', '--content-dir', t.contentDir]);
    expect(r).toEqual({ code: 1, stdout: '', stderr: '' });
    expect(run(['hashes', '--content-dir', t.contentDir]).code).toBe(2);
    expect(run(['hashes', '--pack', 'docker,k8s', '--content-dir', t.contentDir]).code).toBe(2);
    expect(run(['hashes', '--pack', 'nope', '--content-dir', t.contentDir]).code).toBe(2);
  });
});
