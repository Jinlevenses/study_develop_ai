// UT-GATE-180~187 — check:manifest(modes.manifest.json · 6계열·E2E·렌더러 레지스트리, FR-STD-033) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectE2eTitles, parseFormatIds, parseRegistry, resolveE2eId, validateManifest } from '../check-manifest.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-manifest.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-manifest');
const MAN = 'packages/contracts/manifests/modes.manifest.json';
const REG = 'apps/web/src/features/practice/renderers/registry.ts';
const DOM = 'packages/contracts/src/common/domain.ts';
const FAMS = ['개념이해', '실습', '문제', '개념 디깅', 'OX', '백지노트'];

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const mode = (i, fam, e2e, status = 'included') => ({
  mode_id: `M-${String(i).padStart(2, '0')}`,
  name_ko: `모드 ${i}`,
  ur14_family: fam,
  offline_path: '결정적',
  e2e_ids: e2e,
  status,
});
/** 6계열을 1개씩 채운 included 모드(E2E-301..306). */
const full = () => FAMS.map((f, i) => mode(i + 1, f, [`E2E-30${i + 1}`]));

const DOMAIN_TS = "export const FormatId = z.enum(['ox', 'mcq', 'cloze', 'blank_note']);\n";

function withRepo({ modes, files = {}, manifest }, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-mani-'));
  try {
    const put = (rel, v) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    };
    if (manifest !== null) {
      put(MAN, manifest ?? { version: 1, modes });
    }
    for (const [rel, v] of Object.entries(files)) {
      put(rel, v);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const spec = (ids) =>
  `declare function test(t: string, f: () => void): void;\n${ids.map((i) => `test('${i} 제목', () => {});`).join('\n')}\n`;
const e2eSpec = (...ids) => ({ 'tests/e2e/modes.spec.ts': spec(ids) });
const rules = (res) => res.json.violations.map((v) => `${v.rule}:${v.severity}`);
const ALL_TITLES = e2eSpec(...full().flatMap((m) => m.e2e_ids));

test('UT-GATE-180 check:manifest selftest(--int INT-2 --schedule --mode-formats)가 통과하고 위반 fixture가 기대 집합과 일치한다 [FR-STD-033][UR-14]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:manifest'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = path.join(FIX, 'violations');
  const args = JSON.parse(readFileSync(path.join(dir, 'selftest.args.json'), 'utf8'));
  const viol = run(dir, ...args);
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(dir), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'manifest/family-missing',
    'manifest/e2e-missing',
    'manifest/e2e-deferred',
    'manifest/renderer-missing',
    'manifest/renderer-key',
  ]) {
    assert.ok(seen.has(rule), rule);
  }
});

test('UT-GATE-181 UR-14 6계열 중 included 모드가 0인 계열은 manifest/family-missing이다(항상 전체 검사) [FR-STD-033][UR-14]', () => {
  withRepo({ modes: full(), files: ALL_TITLES }, (dir) => {
    const res = run(dir);
    assert.deepEqual(
      rules(res).filter((r) => r.startsWith('manifest/family')),
      [],
    );
  });
  const without = full().map((m) => (m.ur14_family === 'OX' ? { ...m, status: 'deferred' } : m));
  withRepo(
    {
      modes: without,
      files: e2eSpec(
        ...full()
          .flatMap((m) => m.e2e_ids)
          .filter((i) => i !== 'E2E-305'),
      ),
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(
        rules(res).filter((r) => r.startsWith('manifest/family')),
        ['manifest/family-missing:error'],
      );
      assert.match(res.json.violations.find((v) => v.rule === 'manifest/family-missing').message, /"OX"/);
    },
  );
  withRepo({ modes: full().slice(0, 4), files: {} }, (dir) => {
    const res = run(dir, '--int', 'INT-1a', '--schedule', 'tests/e2e/mode-schedule.json');
    assert.equal(res.status, 2, '--schedule 이 가리키는 파일이 없으면 exit 2');
  });
});

test('UT-GATE-182 schedule 이전 모드는 E2E가 없어도 통과하고 도래 모드는 manifest/e2e-missing이다 [FR-STD-033][UR-14]', () => {
  const schedule = {
    version: 1,
    modes: Object.fromEntries(full().map((m, i) => [m.mode_id, i < 3 ? 'INT-1b' : 'INT-3'])),
  };
  const files = { ...e2eSpec('E2E-301', 'E2E-302'), 'tests/e2e/mode-schedule.json': schedule };
  withRepo({ modes: full(), files }, (dir) => {
    const res = run(dir, '--int', 'INT-2', '--schedule', 'tests/e2e/mode-schedule.json');
    const bad = res.json.violations
      .filter((v) => v.rule === 'manifest/e2e-missing')
      .map((v) => v.message.split(':')[0]);
    assert.deepEqual(bad, ['M-03'], 'INT-1b 도래 모드 M-01~03 중 E2E 제목이 없는 M-03만 위반, INT-3 모드는 아직');
  });
  withRepo({ modes: full(), files }, (dir) => {
    const res = run(dir, '--int', 'INT-3', '--schedule', 'tests/e2e/mode-schedule.json');
    const bad = res.json.violations
      .filter((v) => v.rule === 'manifest/e2e-missing')
      .map((v) => v.message.split(':')[0]);
    assert.deepEqual(bad, ['M-03', 'M-04', 'M-05', 'M-06']);
  });
  // schedule에 없는 included 모드 = warn
  const partial = { version: 1, modes: { 'M-01': 'INT-1b' } };
  withRepo({ modes: full(), files: { ...ALL_TITLES, 'tests/e2e/mode-schedule.json': partial } }, (dir) => {
    const res = run(dir, '--int', 'INT-2', '--schedule', 'tests/e2e/mode-schedule.json');
    assert.equal(res.json.violations.filter((v) => v.rule === 'manifest/schedule-missing-mode').length, 5);
    assert.ok(
      res.json.violations
        .filter((v) => v.rule === 'manifest/schedule-missing-mode')
        .every((v) => v.severity === 'warn'),
    );
  });
});

test('UT-GATE-183 SCN-nn 은 E2E-0nn 으로 해석하고 E2E 제목은 `E2E-nnn ` 로 시작하는 문자열 토큰만 센다 [FR-STD-033][UR-14]', () => {
  assert.equal(resolveE2eId('SCN-01'), 'E2E-001');
  assert.equal(resolveE2eId('SCN-12'), 'E2E-012');
  assert.equal(resolveE2eId('E2E-301'), 'E2E-301');
  const modes = [mode(1, '개념이해', ['E2E-301', 'SCN-01']), ...full().slice(1)];
  withRepo({ modes, files: e2eSpec(...modes.flatMap((m) => m.e2e_ids.map(resolveE2eId))) }, (dir) => {
    assert.equal(run(dir).json.violations.filter((v) => v.rule === 'manifest/e2e-missing').length, 0);
  });
  withRepo(
    {
      modes,
      files: e2eSpec(
        'E2E-301',
        ...full()
          .slice(1)
          .flatMap((m) => m.e2e_ids),
      ),
    },
    (dir) => {
      const v = run(dir).json.violations.filter((x) => x.rule === 'manifest/e2e-missing');
      assert.equal(v.length, 1);
      assert.match(v[0].message, /E2E-001/);
    },
  );
  withRepo(
    {
      files: {
        'tests/e2e/a.spec.ts':
          "test('E2E-301 a', () => {}); test(`E2E-302 b`, () => {}); const x = 'see E2E-399 here'; test('prefix E2E-398 x', () => {});",
        'tests/e2e/helper.ts': "test('E2E-397 not a spec', () => {});",
      },
      manifest: { version: 1, modes: [] },
    },
    (dir) => {
      assert.deepEqual([...collectE2eTitles(dir)].sort(), ['E2E-301', 'E2E-302']);
    },
  );
});

test('UT-GATE-184 deferred 모드의 E2E-3nn 제목이 존재하면 manifest/e2e-deferred이다("E2E = included 집합") [FR-STD-033][UR-14]', () => {
  const modes = [...full(), mode(7, '문제', ['E2E-307'], 'deferred'), mode(8, '문제', ['E2E-399'], 'deferred')];
  withRepo({ modes, files: e2eSpec(...full().flatMap((m) => m.e2e_ids)) }, (dir) => {
    assert.deepEqual(
      rules(run(dir)).filter((r) => r.includes('deferred')),
      [],
    );
  });
  withRepo({ modes, files: e2eSpec(...full().flatMap((m) => m.e2e_ids), 'E2E-307') }, (dir) => {
    const res = run(dir);
    const v = res.json.violations.filter((x) => x.rule === 'manifest/e2e-deferred');
    assert.equal(v.length, 1);
    assert.match(v[0].message, /^M-07 is deferred/);
    assert.equal(res.status, 1);
  });
});

test('UT-GATE-185 렌더러 레지스트리 — 첫 `= {` 객체의 깊이 1 키와 e2e_id를 읽고, 도래 모드에 엔트리가 없으면 manifest/renderer-missing이다 [FR-STD-033][UR-14]', () => {
  const entries = parseRegistry(
    "import x from 'y';\nexport const R = {\n  mcq: { c: A, e2e_id: 'E2E-304', nested: { e2e_id: 'E2E-999' } },\n  'blank_note': { e2e_id: 'E2E-313' },\n  ox,\n} as const;\nconst other = { zzz: 1 };\n",
  );
  assert.deepEqual(
    entries.map((e) => [e.key, e.e2e_id]),
    [
      ['mcq', 'E2E-304'],
      ['blank_note', 'E2E-313'],
    ],
  );
  assert.deepEqual(parseRegistry('export const nothing = 1;'), []);
  const reg = `export const R = {\n${full()
    .map((m, i) => `  ${['lesson', 'lab', 'mcq', 'dialog', 'ox', 'blank_note'][i]}: { e2e_id: '${m.e2e_ids[0]}' },`)
    .join('\n')}\n} as const;\n`;
  withRepo({ modes: full(), files: { ...ALL_TITLES, [REG]: reg, [DOM]: DOMAIN_TS } }, (dir) => {
    assert.deepEqual(rules(run(dir)), ['manifest/renderer-formats-unverified:warn']);
  });
  withRepo(
    { modes: full(), files: { ...ALL_TITLES, [REG]: reg.replace("'E2E-303'", "'E2E-399'"), [DOM]: DOMAIN_TS } },
    (dir) => {
      const res = run(dir);
      assert.deepEqual(
        res.json.violations.filter((v) => v.rule === 'manifest/renderer-missing').map((v) => v.message.split(':')[0]),
        ['M-03'],
      );
    },
  );
  // 레지스트리 파일이 없으면 엔트리 0개(오류 아님) → 도래 모드마다 renderer-missing
  withRepo({ modes: full(), files: ALL_TITLES }, (dir) => {
    assert.equal(run(dir).json.violations.filter((v) => v.rule === 'manifest/renderer-missing').length, 6);
  });
});

test('UT-GATE-186 레지스트리 키는 FormatId ∪ BlockKind 밖이면 manifest/renderer-key이고 레지스트리가 있는데 domain.ts가 없으면 exit 2다 [FR-STD-033][UR-14]', () => {
  assert.deepEqual(parseFormatIds(DOMAIN_TS), ['ox', 'mcq', 'cloze', 'blank_note']);
  assert.equal(parseFormatIds('export const X = 1;'), null);
  const reg =
    "export const R = {\n  mcq: { e2e_id: 'E2E-304' },\n  lesson: { e2e_id: 'E2E-301' },\n  triage: { e2e_id: 'E2E-399' },\n  bogus: { e2e_id: 'E2E-398' },\n  'worse key': {},\n} as const;\n";
  withRepo({ modes: [], files: { [REG]: reg, [DOM]: DOMAIN_TS }, manifest: { version: 1, modes: full() } }, (dir) => {
    const res = run(dir);
    const keyed = res.json.violations.filter((v) => v.rule === 'manifest/renderer-key');
    assert.deepEqual(
      keyed.map((v) => `${v.file}:${v.line}`),
      [`${REG}:5`, `${REG}:6`],
    );
    assert.ok(keyed.every((v) => v.severity === 'error'));
  });
  withRepo({ modes: full(), files: { [REG]: reg } }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: domain\.ts not found/);
  });
  withRepo({ modes: full(), files: { [REG]: reg, [DOM]: 'export const Other = 1;' } }, (dir) =>
    assert.equal(run(dir).status, 2),
  );
});

test('UT-GATE-187 --mode-formats 교집합 판정, 옵션 없이는 renderer-formats-unverified warn 1건, 매니페스트·schedule 부재는 exit 2다 [FR-STD-033][UR-14]', () => {
  const reg = "export const R = {\n  mcq: { e2e_id: 'E2E-303' },\n  ox: { e2e_id: 'E2E-305' },\n} as const;\n";
  const modes = [
    mode(1, '문제', ['E2E-303']),
    mode(2, 'OX', ['E2E-305']),
    ...FAMS.filter((f) => f !== '문제' && f !== 'OX').map((f, i) => mode(i + 3, f, [`E2E-31${i}`], 'deferred')),
  ];
  const files = { [REG]: reg, [DOM]: DOMAIN_TS, ...e2eSpec('E2E-303', 'E2E-305') };
  withRepo({ modes, files }, (dir) => {
    const res = run(dir);
    assert.deepEqual(
      rules(res).filter((r) => r.includes('formats')),
      ['manifest/renderer-formats-unverified:warn'],
    );
  });
  const formats = (obj) => ({ ...files, 'formats.json': obj });
  withRepo({ modes, files: formats({ 'M-01': ['mcq', 'cloze'], 'M-02': ['ox'] }) }, (dir) => {
    const res = run(dir, '--mode-formats', 'formats.json');
    assert.deepEqual(
      rules(res).filter((r) => r.includes('renderer')),
      [],
      '경고도 없다',
    );
  });
  withRepo({ modes, files: formats({ 'M-01': ['cloze', 'matching'], 'M-02': ['ox'] }) }, (dir) => {
    const res = run(dir, '--mode-formats', 'formats.json');
    const v = res.json.violations.filter((x) => x.rule === 'manifest/renderer-missing');
    assert.equal(v.length, 1);
    assert.match(v[0].message, /^M-01: no registry key among format candidates/);
  });
  withRepo({ modes, files }, (dir) => {
    assert.equal(run(dir, '--mode-formats', 'absent.json').status, 2);
    assert.equal(run(dir, '--int', 'INT-9').status, 2);
    assert.equal(run(dir, '--schedule', 'absent.json', '--int', 'INT-2').status, 2);
    assert.equal(run(dir, '--schedule', 'absent.json').status, 2, '--schedule 은 --int 필요');
  });
  withRepo({ manifest: null }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: modes manifest not found/);
  });
  // 스키마
  const bad = (json) => validateManifest(json).map((p) => p.message);
  assert.match(bad({ version: 2, modes: [] })[0], /version must be 1/);
  assert.match(bad({ version: 1, modes: 'x' })[0], /modes must be an array/);
  assert.match(bad({ version: 1, modes: [{ ...mode(1, '문제', []), mode_id: 'X-1' }] })[0], /mode_id must match/);
  assert.match(bad({ version: 1, modes: [mode(1, '문제', []), mode(1, '문제', [])] })[0], /duplicate mode_id M-01/);
  assert.match(bad({ version: 1, modes: [mode(1, '코딩', [])] })[0], /ur14_family/);
  assert.match(bad({ version: 1, modes: [mode(1, '문제', [], 'maybe')] })[0], /status/);
  assert.match(bad({ version: 1, modes: [{ mode_id: 'M-01' }] })[0], /missing field/);
});
