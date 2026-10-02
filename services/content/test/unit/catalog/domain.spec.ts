import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { conceptCatalogVersion, nextCatalogVersion } from '../../../src/domain/catalog/catalog-version.js';
import { decodeConceptCursor, encodeConceptCursor } from '../../../src/domain/catalog/cursor.js';
import type { PackRowSummary } from '../../../src/domain/catalog/install/decide.js';
import { decideInstall } from '../../../src/domain/catalog/install/decide.js';
import type { ConceptDigest } from '../../../src/domain/catalog/install/diff.js';
import { diffConcepts, diffKus } from '../../../src/domain/catalog/install/diff.js';
import { compareSemver } from '../../../src/domain/catalog/install/semver.js';
import type { ViewRow } from '../../../src/domain/catalog/install/view.js';
import { buildInstallView } from '../../../src/domain/catalog/install/view.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const cand = (version: string, hash = H1) => ({ pack_id: 'k8s', version, manifest_hash: hash });
const row = (
  version: string,
  state: PackRowSummary['state'],
  hash = H1,
  id = `i-${version}-${state}`,
): PackRowSummary => ({
  install_id: id,
  version,
  manifest_hash: hash,
  state,
});

describe('catalog 순수 도메인 (domain/catalog)', () => {
  describe('UT-CT-028 decideInstall 표 전수', () => {
    it('행이 없으면 load [FR-CUR-002][CR-12]', () => {
      expect(decideInstall(cand('1.0.0'), [], false)).toEqual({ action: 'load' });
    });

    it('loading·ready 행이 있으면 in_progress [FR-CUR-002][CR-12]', () => {
      for (const state of ['loading', 'ready'] as const) {
        expect(decideInstall(cand('1.1.0'), [row('1.0.0', 'active'), row('1.1.0', state)], false)).toMatchObject({
          action: 'reject',
          fault: 'in_progress',
        });
      }
    });

    it('같은 버전 active·같은 hash는 noop(그 install_id 보고) [FR-CUR-002][CR-12]', () => {
      expect(decideInstall(cand('1.0.0'), [row('1.0.0', 'active', H1, 'X')], false)).toEqual({
        action: 'noop',
        install_id: 'X',
      });
    });

    it('같은 버전이 다른 hash로 active·retired면 version_conflict [FR-CUR-002][CR-12]', () => {
      for (const state of ['active', 'retired'] as const) {
        expect(decideInstall(cand('1.0.0', H2), [row('1.0.0', state, H1)], false)).toMatchObject({
          action: 'reject',
          fault: 'version_conflict',
        });
      }
    });

    it('같은 버전 retired·같은 hash는 reactivate, 활성 버전이 더 높으면 allow_downgrade가 필요하다 [FR-CUR-002][CR-12]', () => {
      expect(decideInstall(cand('1.0.0'), [row('1.0.0', 'retired', H1, 'R')], false)).toEqual({
        action: 'reactivate',
        install_id: 'R',
      });
      const rows = [row('1.0.0', 'retired', H1, 'R'), row('1.1.0', 'active', H2, 'A')];
      expect(decideInstall(cand('1.0.0'), rows, false)).toMatchObject({ action: 'reject', fault: 'downgrade' });
      expect(decideInstall(cand('1.0.0'), rows, true)).toEqual({ action: 'reactivate', install_id: 'R' });
    });

    it('활성 버전 > 후보 ∧ !allow_downgrade면 downgrade, allow_downgrade면 load [FR-CUR-002][CR-12]', () => {
      const rows = [row('1.2.0', 'active', H2)];
      expect(decideInstall(cand('1.1.0'), rows, false)).toMatchObject({ action: 'reject', fault: 'downgrade' });
      expect(decideInstall(cand('1.1.0'), rows, true)).toEqual({ action: 'load' });
    });

    it('더 높은 버전·failed 행뿐인 같은 버전은 load [FR-CUR-002][CR-12]', () => {
      expect(decideInstall(cand('1.1.0'), [row('1.0.0', 'active', H2)], false)).toEqual({ action: 'load' });
      expect(decideInstall(cand('1.0.0'), [row('1.0.0', 'failed', H2)], false)).toEqual({ action: 'load' });
    });
  });

  it('UT-CT-029 compareSemver는 SemVer 2.0 우선순위(사전 릴리스 < 릴리스)를 따른다 [FR-CUR-002]', () => {
    // Arrange: 명세 §11 예시 순서
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ];
    // Act / Assert
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = 0; j < ordered.length; j += 1) {
        const expected = i === j ? 0 : i < j ? -1 : 1;
        expect(compareSemver(ordered[i] as string, ordered[j] as string), `${ordered[i]} vs ${ordered[j]}`).toBe(
          expected,
        );
      }
    }
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(/invariant/);
  });

  describe('UT-CT-031 개념 change 분류', () => {
    const d = (id: string, hash: string, tier: 'A' | 'B' | 'C' = 'A', dep: string | null = null): ConceptDigest => ({
      concept_id: id,
      content_hash: hash,
      tier,
      deprecated_by: dep,
    });

    it('prev가 없으면 전부 published, 같은 hash는 변경 없음 [CR-12][CR-41]', () => {
      expect(diffConcepts(null, [d('k8s.b', H1), d('k8s.a', H1)])).toEqual([
        { concept_id: 'k8s.a', change: 'published' },
        { concept_id: 'k8s.b', change: 'published' },
      ]);
      expect(diffConcepts([d('k8s.a', H1)], [d('k8s.a', H1)])).toEqual([]);
    });

    it('published·revised·deprecated·tier_promoted 4종과 우선순위 [CR-12][CR-41]', () => {
      const prev = [
        d('k8s.rev', H1),
        d('k8s.dep', H1),
        d('k8s.up', H1, 'C'),
        d('k8s.down', H1, 'A'),
        d('k8s.same', H1),
        d('k8s.both', H1, 'C'),
        d('k8s.already', H1, 'A', 'k8s.rev'),
      ];
      const next = [
        d('k8s.new', H2),
        d('k8s.rev', H2),
        d('k8s.dep', H2, 'A', 'k8s.rev'),
        d('k8s.up', H2, 'B'),
        d('k8s.down', H2, 'C'),
        d('k8s.same', H1),
        d('k8s.both', H2, 'A', 'k8s.rev'),
        d('k8s.already', H2, 'A', 'k8s.rev'),
      ];
      expect(diffConcepts(prev, next)).toEqual([
        { concept_id: 'k8s.already', change: 'revised' },
        { concept_id: 'k8s.both', change: 'deprecated' },
        { concept_id: 'k8s.dep', change: 'deprecated' },
        { concept_id: 'k8s.down', change: 'revised' },
        { concept_id: 'k8s.new', change: 'published' },
        { concept_id: 'k8s.rev', change: 'revised' },
        { concept_id: 'k8s.up', change: 'tier_promoted' },
      ]);
    });

    it('KU 차분은 새 KU·hash가 다른 KU만, prev가 없으면 전부(정렬) [CR-41]', () => {
      const next = new Map([
        ['k8s.a.k02', H2],
        ['k8s.a.k01', H1],
        ['k8s.a.k03', H1],
      ]);
      expect(diffKus(null, next)).toEqual(['k8s.a.k01', 'k8s.a.k02', 'k8s.a.k03']);
      expect(
        diffKus(
          new Map([
            ['k8s.a.k01', H1],
            ['k8s.a.k02', H1],
          ]),
          next,
        ),
      ).toEqual(['k8s.a.k02', 'k8s.a.k03']);
    });
  });

  it('UT-CT-032 catalog 버전은 단조 +1이고 바뀌지 않은 개념은 이전 값을 이어받는다 [CR-41]', () => {
    expect(nextCatalogVersion(null)).toBe(1);
    expect(nextCatalogVersion(0)).toBe(1);
    expect(nextCatalogVersion(7)).toBe(8);
    expect(() => nextCatalogVersion(-1)).toThrow(/invariant/);
    expect(() => nextCatalogVersion(1.5)).toThrow(/invariant/);
    expect(conceptCatalogVersion(true, 9, 3)).toBe(9);
    expect(conceptCatalogVersion(false, 9, 3)).toBe(3);
    expect(conceptCatalogVersion(false, 9, null)).toBe(9);
  });

  describe('UT-CT-033 설치 view 상태 매핑·problem 모양', () => {
    const base: ViewRow = {
      pack_id: 'k8s',
      track_id: 'k8s',
      version: '1.0.0',
      state: 'loading',
      state_reason: null,
      created_at: 1000,
      activated_at: null,
      previous_version: null,
      error_id: null,
      finished_at: null,
    };
    const req = fixedUlid(1);

    it('진행 중 phase(메모리)가 상태를 정한다 — 종료 시각은 null [FR-CUR-002]', () => {
      const memory = {
        packs: [{ pack_id: 'k8s', track: 'k8s', version: '1.0.0', previous_version: null }],
        phase: 'activating' as const,
        started_at: 900,
        finished_at: null,
        failure: null,
      };
      const view = buildInstallView(req, [base], memory, 5000);
      expect(view).toMatchObject({
        install_id: req,
        state: 'activating',
        problem: null,
        started_at: 900,
        finished_at: null,
      });
      expect(view.packs).toEqual([
        { pack_id: 'k8s', track: 'k8s', version: '1.0.0', previous_version: null, conflicts: 0 },
      ]);
    });

    it('행만 있고 phase가 없으면 loading, 전부 active·retired면 activated(finished = 최대 activated_at) [FR-CUR-002]', () => {
      expect(buildInstallView(req, [base], null, 5000)).toMatchObject({
        state: 'loading',
        finished_at: null,
        started_at: 1000,
      });
      const done = buildInstallView(
        req,
        [
          { ...base, state: 'active', activated_at: 2500, previous_version: '0.9.0' },
          { ...base, pack_id: 'db', track_id: 'db', state: 'retired', activated_at: 2000, created_at: 800 },
        ],
        null,
        5000,
      );
      expect(done).toMatchObject({ state: 'activated', started_at: 800, finished_at: 2500, problem: null });
      expect(done.packs.map((p) => p.pack_id)).toEqual(['db', 'k8s']);
      expect(done.packs.find((p) => p.pack_id === 'k8s')?.previous_version).toBe('0.9.0');
    });

    it('failed 행이 하나라도 있으면 failed + problem(CT-INTERNAL-900) [FR-CUR-002]', () => {
      const errorId = fixedUlid(77);
      const view = buildInstallView(
        req,
        [
          { ...base, state: 'failed', state_reason: 'pack_load:merkle_mismatch', error_id: errorId, finished_at: 3000 },
          { ...base, pack_id: 'db', track_id: 'db', state: 'active', activated_at: 2000 },
        ],
        null,
        5000,
      );
      expect(view.state).toBe('failed');
      expect(view.finished_at).toBe(3000);
      expect(view.problem).toMatchObject({
        type: 'urn:fathom:problem:ct-internal-900',
        status: 500,
        code: 'CT-INTERNAL-900',
        detail: 'pack_load:merkle_mismatch',
        error_id: errorId,
        request_id: req,
        retryable: false,
      });
    });

    it('행이 없는 요청(noop)은 메모리만으로 activated이고 메모리 실패도 failed로 본다 [FR-CUR-002][CR-12]', () => {
      const packs = [{ pack_id: 'k8s', track: 'k8s', version: '1.0.0', previous_version: null }];
      expect(
        buildInstallView(req, [], { packs, phase: null, started_at: 100, finished_at: 100, failure: null }, 5000),
      ).toMatchObject({ state: 'activated', started_at: 100, finished_at: 100 });
      const failed = buildInstallView(
        req,
        [],
        {
          packs,
          phase: null,
          started_at: 100,
          finished_at: 200,
          failure: { detail: 'pack_load:internal', error_id: fixedUlid(5), finished_at: 200 },
        },
        5000,
      );
      expect(failed.state).toBe('failed');
      expect(failed.problem?.detail).toBe('pack_load:internal');
    });
  });

  it('UT-CT-047 트랙 개념 커서는 왕복 가역이고 모양·범위가 틀리면 null이다 [FR-CUR-001]', () => {
    for (const c of [
      { level: 1, concept_id: 'k8s.pod' },
      { level: 5, concept_id: 'cloud.vpc-peering' },
      { level: 3, concept_id: 'u.acme.vpn-setup' },
    ]) {
      const encoded = encodeConceptCursor(c);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeConceptCursor(encoded)).toEqual(c);
    }
    expect(encodeConceptCursor({ level: 2, concept_id: 'k8s.pod' })).toBe('2-k8s_pod');
    for (const bad of ['', 'x', '0-k8s_pod', '6-k8s_pod', '1-', '1-NOT_A_CONCEPT', '1-k8s.pod', 'k8s_pod']) {
      expect(decodeConceptCursor(bad), bad).toBeNull();
    }
  });
});
