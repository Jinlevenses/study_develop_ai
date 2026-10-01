// UT-GATE-230~239 — GritQL 플러그인 스냅샷 테스트(NFR-MAINT-005, STD-GATE-07).
// fixture(tools/gates/fixtures/biome-plugins/{clean,violations})를 Biome 2.5.14로 lint해 진단 배열을 스냅샷과 비교한다.
// FATHOM_UPDATE_SNAPSHOTS=1 이면 비교 대신 스냅샷을 다시 쓰고 통과한다(D-B10).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BIOME = join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const FIXTURES = join(ROOT, 'tools', 'gates', 'fixtures', 'biome-plugins');
const SNAPSHOTS = join(ROOT, 'tools', 'biome-plugins', '__snapshots__');
const UPDATE = process.env.FATHOM_UPDATE_SNAPSHOTS === '1';

/** 변형 디렉터리를 lint해 `[{file, line, rule}]`(file→line→rule 오름차순)을 돌려준다. */
function runVariant(variant) {
  const dir = join(FIXTURES, variant);
  const result = spawnSync(
    process.execPath,
    [
      BIOME,
      'lint',
      '--colors=off',
      '--reporter=json',
      '--max-diagnostics=1000',
      `--config-path=${join(dir, 'biome.fixture.json')}`,
      dir,
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // 비 0 종료는 위반이 있다는 뜻일 뿐이므로 stdout으로 판정한다.
  const report = JSON.parse(result.stdout);
  const diagnostics = report.diagnostics.map((d) => {
    const abs = join(ROOT, d.location.path);
    const message = String(d.message);
    return {
      file: relative(dir, abs).split(sep).join(posix.sep),
      line: d.location.start.line,
      rule: message.slice(0, Math.max(message.indexOf(':'), 0)),
    };
  });
  diagnostics.sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
  return { diagnostics, messages: report.diagnostics.map((d) => String(d.message)) };
}

function snapshotPath(variant) {
  return join(SNAPSHOTS, `${variant}.json`);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 규칙 묶음 키: jev/index-* · sql/* 는 접미를 묶는다. */
function ruleGroup(rule) {
  if (rule.startsWith('jev/index-')) {
    return 'jev/index-*';
  }
  if (rule.startsWith('sql/')) {
    return 'sql/*';
  }
  return rule;
}

const EXPECTED_VIOLATION_GROUPS = {
  'boundary/cross-service-import': 10,
  'design/raw-color': 6,
  'jev/index-*': 18,
  'ng-g1/reward-vocab': 4,
  'ng-g2/network-share': 1,
  'ng-g2/social-vocab': 2,
  'ng-g3/presubmit-field': 7,
  'ng-g4/hard-lock': 4,
  'ng-g5/danger-due': 3,
  'ng-g5/loss-copy': 2,
  'ng-g5/push-api': 2,
  'ng-g6/video': 3,
  'ng-g7/presubmit-ai-call': 3,
  'sql/*': 11,
};

describe('biome GritQL 플러그인', () => {
  let clean;
  let violations;

  before(() => {
    clean = runVariant('clean');
    violations = runVariant('violations');
    if (UPDATE) {
      mkdirSync(SNAPSHOTS, { recursive: true });
      writeFileSync(snapshotPath('clean'), serialize(clean.diagnostics));
      writeFileSync(snapshotPath('violations'), serialize(violations.diagnostics));
    }
  });

  const byGroup = (prefix) => violations.diagnostics.filter((d) => ruleGroup(d.rule).startsWith(prefix));

  it('UT-GATE-230 clean fixture 진단 0건이고 스냅샷과 같다 [NFR-MAINT-005][NFR-MAINT-001]', () => {
    assert.deepEqual(clean.diagnostics, []);
    assert.deepEqual(JSON.parse(readFileSync(snapshotPath('clean'), 'utf8')), []);
  });

  it('UT-GATE-231 violations 진단 배열이 스냅샷과 같다(76건) [NFR-MAINT-005]', () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath('violations'), 'utf8'));
    assert.deepEqual(violations.diagnostics, snapshot);
    assert.equal(violations.diagnostics.length, 76);
    const counts = {};
    for (const d of violations.diagnostics) {
      counts[ruleGroup(d.rule)] = (counts[ruleGroup(d.rule)] ?? 0) + 1;
    }
    assert.deepEqual(counts, EXPECTED_VIOLATION_GROUPS);
  });

  it('UT-GATE-232 boundary/cross-service-import는 services·apps·packages 파일에서만 나온다 [NFR-MAINT-001]', () => {
    const hits = byGroup('boundary/cross-service-import');
    assert.ok(hits.length >= 1);
    for (const d of hits) {
      assert.match(d.file, /^(services|apps|packages)\//);
    }
  });

  it('UT-GATE-233 jev/index-*는 services/*/src/jev/** 또는 *.jev.ts에서만 나온다 [FR-AI-005]', () => {
    const hits = byGroup('jev/index-*');
    assert.ok(hits.length >= 1);
    for (const d of hits) {
      assert.match(d.file, /^services\/[^/]+\/src\/jev\/|\.jev\.ts$/);
    }
  });

  it('UT-GATE-234 sql/*는 services/*/src 또는 shared-kernel/src의 .ts에서만 나온다 [NFR-MAINT-005]', () => {
    const hits = byGroup('sql/*');
    assert.ok(hits.length >= 1);
    for (const d of hits) {
      assert.match(d.file, /^(services\/[^/]+\/src\/|packages\/shared-kernel\/src\/).*\.ts$/);
    }
  });

  it('UT-GATE-235 design/raw-color·ng-g1·ng-g2·ng-g5는 각 1건 이상이고 design-tokens 진단은 0이다 [FR-UX-008][NFR-UX-008]', () => {
    for (const prefix of ['design/raw-color', 'ng-g1/', 'ng-g2/', 'ng-g5/']) {
      assert.ok(byGroup(prefix).length >= 1, prefix);
    }
    assert.equal(violations.diagnostics.filter((d) => d.file.startsWith('packages/design-tokens/')).length, 0);
  });

  it('UT-GATE-236 CSS 진단은 1건 이상이고 apps/web/src·packages/ui/src에서만 나온다 [FR-UX-008]', () => {
    const css = violations.diagnostics.filter((d) => d.file.endsWith('.css'));
    assert.ok(css.length >= 1);
    for (const d of css) {
      assert.match(d.file, /^(apps\/web\/src|packages\/ui\/src)\//);
    }
  });

  it('UT-GATE-237 ng-g3/presubmit-field는 1건 이상이고 post-submit 파일 진단은 0이다 [FR-QST-022]', () => {
    assert.ok(byGroup('ng-g3/presubmit-field').length >= 1);
    assert.equal(violations.diagnostics.filter((d) => d.file.includes('/post-submit/')).length, 0);
  });

  it('UT-GATE-238 ng-g4/hard-lock은 routing 도메인에서, ng-g6/video는 contracts/src(문자열)·web/ui .tsx(요소)에서만 나온다 [FR-UX-008]', () => {
    const locks = byGroup('ng-g4/hard-lock');
    assert.ok(locks.length >= 1);
    for (const d of locks) {
      assert.match(d.file, /\/domain\/practice\/routing\//);
    }
    const videos = byGroup('ng-g6/video');
    assert.ok(videos.length >= 1);
    // 문자열 리터럴 규칙은 contracts/src, `<video>` 요소 규칙(ng-g-ts)은 web·ui 의 .tsx 에서 나온다.
    assert.ok(videos.some((d) => d.file.startsWith('packages/contracts/src/')));
    for (const d of videos) {
      assert.match(d.file, /^(packages\/contracts\/src\/|(apps\/web|packages\/ui)\/src\/.*\.tsx$)/);
    }
  });

  it('UT-GATE-239 ng-g7/presubmit-ai-call은 post-submit 밖에서만 나오고 모든 메시지가 규칙 ID 접두를 가진다 [FR-STD-018]', () => {
    assert.ok(byGroup('ng-g7/presubmit-ai-call').length >= 1);
    assert.equal(violations.diagnostics.filter((d) => d.file.includes('blank-note/post-submit/')).length, 0);
    assert.ok(violations.messages.length >= 1);
    for (const message of violations.messages) {
      assert.match(message, /^[a-z0-9-]+\/[a-z0-9*-]+: /);
    }
  });
});
