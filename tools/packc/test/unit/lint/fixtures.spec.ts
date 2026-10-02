// UT-PACKC-042 — fixtures/*/*/fixture.json 전수(규칙별 음성 fixture, ADR-004 §2).
import { afterEach, describe, expect, it } from 'vitest';
import { lines, listCases, materialize, rmTmp, run, tmpRoot } from '../cli/helpers.js';

const cases = listCases();
let root = '';

afterEach(() => {
  if (root !== '') {
    rmTmp(root);
    root = '';
  }
});

describe('UT-PACKC-042 negative fixtures [FR-CUR-003][ADR-004]', () => {
  it('UT-PACKC-042 covers the 10 V2 rules and V1 with at least one negative fixture each [FR-CUR-003][ADR-004]', () => {
    const covered = new Set<string>();
    for (const c of cases) {
      for (const r of c.spec.expect.rules) {
        covered.add(r);
      }
    }
    for (const rule of [
      'V1',
      'R-ID',
      'R-DAG',
      'R-LVL',
      'R-REF',
      'R-SRC',
      'R-3STAGE',
      'R-REQ',
      'R-ALIAS',
      'R-POOL',
      'R-FMT',
    ]) {
      expect(covered.has(rule), rule).toBe(true);
    }
  });

  for (const c of cases) {
    it(`UT-PACKC-042 fixture ${c.rule}/${c.name} -> exit ${c.spec.expect.exit} with ${c.spec.expect.rules.join(',')} [FR-CUR-003][ADR-004]`, () => {
      root = tmpRoot();
      const contentDir = materialize(root, { ...c.spec, overlay: c.dir });
      const r = run(['check', '--content-dir', contentDir, ...c.spec.args]);
      expect(r.code).toBe(c.spec.expect.exit);
      const found = lines(r.stdout).map((l) => l.split(' ')[1]);
      for (const rule of c.spec.expect.rules) {
        expect(found, `${rule} missing in:\n${r.stdout}`).toContain(rule);
      }
    });
  }
});
