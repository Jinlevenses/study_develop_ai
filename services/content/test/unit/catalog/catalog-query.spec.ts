import { commonErrorCode } from '@fathom/contracts/common/errors';
import { Page } from '@fathom/contracts/common/pagination';
import { ConceptRef } from '@fathom/contracts/events/catalog/catalog';
import {
  ConceptSummary,
  CurriculumExportLine,
  InstalledPackList,
  TrackCatalog,
} from '@fathom/contracts/http/content/v1/catalog';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { AppError } from '@fathom/shared-kernel/errors/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CURSOR_INVALID_CODE, createCatalogQuery } from '../../../src/application/catalog/catalog-query.js';
import { createCatalogReader } from '../../../src/application/catalog/catalog-reader.js';
import { conceptRefsOfActive } from '../../../src/application/catalog/concept-ref.js';
import { exportCurriculum } from '../../../src/application/catalog/export-curriculum.js';
import type { Ctx } from './support/context.js';
import { createCtx } from './support/context.js';
import { rows } from './support/db.js';
import type { PackSpec } from './support/fpack-writer.js';

let c: Ctx;
beforeEach(async () => {
  c = await createCtx();
});
afterEach(() => {
  c.fx.close();
});

const K8S: PackSpec = {
  version: '1.0.0',
  sort_order: 10,
  offline_cap_level: 3,
  oracle_cap_level: 4,
  concepts: [
    { slug: 'pod', level: 1, kus: 2, mcs: 1, required_for_level: 1 },
    { slug: 'config-map', level: 1 },
    { slug: 'service', level: 2, prereqs: ['pod'] },
    { slug: 'ingress', level: 3, prereqs: ['service', 'pod'] },
    { slug: 'operator', level: 5, tier: 'C' },
  ],
};
const DB: PackSpec = {
  track: 'db',
  version: '2.0.0',
  sort_order: 5,
  offline_cap_level: 0,
  oracle_cap_level: 0,
  concepts: [
    { slug: 'index', level: 1 },
    { slug: 'mvcc', level: 2 },
  ],
};

async function installAll(...specs: PackSpec[]): Promise<void> {
  for (const spec of specs) {
    c.put(spec);
  }
  const res = c.installer.install(c.req({ kind: 'bundled', track: null }));
  if (!res.ok) {
    throw new Error(res.error.code);
  }
  await c.installer.idle();
}

function lines(since?: number): string[] {
  return [...exportCurriculum(c.fx.db, since === undefined ? {} : { since }, c.fx.clock)];
}
const parsed = (all: string[]): CurriculumExportLine[] => all.map((l) => CurriculumExportLine.parse(JSON.parse(l)));

describe('CatalogQuery (활성 뷰 조회)', () => {
  it('UT-CT-045 listPacks는 활성 설치만 pack_id 순으로 InstalledPackList를 통과한다 [FR-CUR-001]', async () => {
    // Arrange
    await installAll(K8S, DB);
    const q = createCatalogQuery(c.fx.db);
    // Act
    const list = q.listPacks();
    // Assert
    expect(InstalledPackList.safeParse(list).success).toBe(true);
    expect(list.packs.map((p) => `${p.pack_id}@${p.version}`)).toEqual(['db@2.0.0', 'k8s@1.0.0']);
    const k8s = list.packs[1];
    expect(k8s).toMatchObject({
      track: 'k8s',
      channel: 'seed',
      counts: { concepts: 5, kus: 6, misconceptions: 1, items: 0, cases: 0 },
      report: { tier_counts: { A: 4, B: 0, C: 1 }, cap_blockers: [] },
    });
    expect(k8s?.report.kpi).toEqual({ offline_learnable: 5, three_stage: { full: 0.8, lite: 0, skeleton: 0.2 } });
    expect(k8s?.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k8s?.activated_at).toBe(c.fx.clock.now());
    // 새 버전을 올리면 은퇴한 설치는 목록에서 빠진다.
    c.put({ ...K8S, version: '1.1.0' });
    c.installer.install(c.req({ kind: 'bundled', track: 'k8s' }));
    await c.installer.idle();
    expect(q.listPacks().packs.map((p) => `${p.pack_id}@${p.version}`)).toEqual(['db@2.0.0', 'k8s@1.1.0']);
  });

  it('UT-CT-046 listTracks는 sort_order 순·레벨 개수 튜플·cap Level 하한 1 보정·display = oracle·kpi를 낸다 [FR-CUR-001]', async () => {
    // Arrange
    await installAll(K8S, DB);
    // Act
    const catalog = createCatalogQuery(c.fx.db).listTracks();
    // Assert
    expect(TrackCatalog.safeParse(catalog).success).toBe(true);
    expect(catalog.tracks.map((t) => t.track)).toEqual(['db', 'k8s']); // sort_order 5 < 10
    const [db, k8s] = catalog.tracks;
    expect(k8s).toMatchObject({
      title_ko: '트랙 k8s',
      title_en: 'Track k8s',
      concept_counts: [2, 1, 1, 0, 1],
      cap: { declared: 5, offline: 3, oracle: 4, display: 4 },
      pack: { pack_id: 'k8s', version: '1.0.0', channel: 'seed' },
    });
    expect(k8s?.kpi.three_stage.full).toBeCloseTo(0.8);
    // 팩이 선언한 cap 0은 Level 하한(1)으로 올려 표시한다.
    expect(db).toMatchObject({
      concept_counts: [1, 1, 0, 0, 0],
      cap: { declared: 2, offline: 1, oracle: 1, display: 1 },
    });
  });

  it('UT-CT-047 트랙 개념 페이지·커서 왕복·level 필터·무효 커서 VAL-903·트랙 없음 404 [FR-CUR-001]', async () => {
    // Arrange
    await installAll(K8S, DB);
    const q = createCatalogQuery(c.fx.db);
    const idsOf = (r: ReturnType<typeof q.listTrackConcepts>): string[] =>
      r.ok ? r.value.items.map((i) => i.concept_id) : [];
    // Act: 한 번에 전부(기본 limit 200)
    const all = q.listTrackConcepts('k8s', {});
    // Assert
    expect(all.ok).toBe(true);
    expect(idsOf(all)).toEqual(['k8s.config-map', 'k8s.pod', 'k8s.service', 'k8s.ingress', 'k8s.operator']);
    if (all.ok) {
      expect(all.value.next_cursor).toBeNull();
      expect(Page(ConceptSummary).safeParse(all.value).success).toBe(true);
      expect(all.value.items[1]).toMatchObject({
        concept_id: 'k8s.pod',
        track: 'k8s',
        level: 1,
        tier: 'A',
        knowledge_type: 'C',
        required_for_level: 1,
        deprecated_by: null,
        aliases: ['별칭-pod'],
        tags: ['stack:k8s'],
      });
    }
    // 페이지(limit 2) 끝까지 따라가면 중복·누락 없이 같은 순서
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = q.listTrackConcepts('k8s', cursor === undefined ? { limit: 2 } : { limit: 2, cursor });
      if (!page.ok) {
        throw new Error('page failed');
      }
      seen.push(...page.value.items.map((i) => i.concept_id));
      pages += 1;
      if (page.value.next_cursor === null) {
        break;
      }
      expect(page.value.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      cursor = page.value.next_cursor;
    }
    expect(seen).toEqual(idsOf(all));
    expect(pages).toBe(3);
    // 정확히 limit만큼 남았을 때는 next_cursor가 null이다.
    const exact = q.listTrackConcepts('k8s', { limit: 5 });
    expect(exact.ok && exact.value.next_cursor).toBeNull();
    // level 필터
    expect(idsOf(q.listTrackConcepts('k8s', { level: 1 }))).toEqual(['k8s.config-map', 'k8s.pod']);
    expect(idsOf(q.listTrackConcepts('k8s', { level: 4 }))).toEqual([]);
    // 무효 커서
    const bad = q.listTrackConcepts('k8s', { cursor: 'garbage' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const e: AppError = bad.error;
      expect(e).toMatchObject({ code: 'CT-VAL-903', status: 400 });
      expect(e.code).toBe(commonErrorCode('CT', 'VAL-903'));
      expect(CURSOR_INVALID_CODE).toBe(commonErrorCode('CT', 'VAL-903'));
    }
    // 활성 트랙이 아님
    const none = q.listTrackConcepts('net', {});
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.error).toMatchObject({ code: 'CT-NOTFOUND-004', status: 404 });
    }
  });

  it('UT-CT-048 export full — header·concept 줄(개념 ID 순)·end(count·sha256 재계산 일치), 모든 줄이 CurriculumExportLine을 통과한다 [FR-CUR-001][CR-41]', async () => {
    // Arrange: k8s가 먼저(catalog 1), db가 다음(catalog 2)
    c.put(K8S);
    c.installer.install(c.req({ kind: 'bundled', track: 'k8s' }));
    await c.installer.idle();
    c.fx.clock.advance(1000);
    c.put(DB);
    c.installer.install(c.req({ kind: 'bundled', track: 'db' }));
    await c.installer.idle();
    // Act
    const all = lines();
    // Assert
    expect(all.every((l) => l.endsWith('\n') && l.indexOf('\n') === l.length - 1)).toBe(true);
    const objs = parsed(all);
    expect(objs.length).toBe(2 + 7);
    const header = objs[0];
    const packs = [
      { pack_id: 'db', track: 'db', version: '2.0.0', manifest_hash: expect.any(String) },
      { pack_id: 'k8s', track: 'k8s', version: '1.0.0', manifest_hash: expect.any(String) },
    ];
    expect(header).toMatchObject({
      kind: 'header',
      v: 1,
      version: 2,
      full: true,
      generated_at: c.fx.clock.now(),
      packs,
    });
    if (header?.kind !== 'header') {
      throw new Error('first line must be header');
    }
    expect(header.pack_set_hash).toBe(sha256Hex(canonicalJson(header.packs)));
    const concepts = objs.slice(1, -1).map((o) => (o.kind === 'concept' ? o.concept.concept_id : '?'));
    expect(concepts).toEqual([
      'db.index',
      'db.mvcc',
      'k8s.config-map',
      'k8s.ingress',
      'k8s.operator',
      'k8s.pod',
      'k8s.service',
    ]);
    const end = objs.at(-1);
    expect(end).toEqual({ kind: 'end', count: all.length - 1, sha256: sha256Hex(all.slice(0, -1).join('')) });
    // case·inventory·path 줄은 IT-01 팩에 없다.
    expect(objs.some((o) => ['case', 'inventory', 'path'].includes(o.kind))).toBe(false);
    // 같은 입력이면 같은 바이트(시계 고정)
    expect(lines()).toEqual(all);
  });

  it('UT-CT-048 export 증분(since) — version > since인 개념만, since가 최신 이상이면 개념 0줄, 더 크면 full [CR-41]', async () => {
    // Arrange: v1(catalog 1) → v2(catalog 2): pod만 개정
    await installAll(K8S);
    c.put({
      ...K8S,
      version: '1.1.0',
      concepts: K8S.concepts.map((x) => (x.slug === 'pod' ? { ...x, rev: 1 } : x)),
    });
    c.installer.install(c.req({ kind: 'bundled', track: 'k8s' }));
    await c.installer.idle();
    // Act / Assert
    const conceptIds = (all: string[]): string[] =>
      parsed(all).flatMap((o) => (o.kind === 'concept' ? [o.concept.concept_id] : []));
    const inc = lines(1);
    expect(parsed(inc)[0]).toMatchObject({ kind: 'header', version: 2, full: false });
    expect(conceptIds(inc)).toEqual(['k8s.pod']);
    expect(parsed(inc).at(-1)).toEqual({ kind: 'end', count: 2, sha256: sha256Hex(inc.slice(0, -1).join('')) });
    expect(conceptIds(lines(0))).toHaveLength(5); // since 0 = version > 0 인 것(전부)이지만 full은 아니다
    expect(parsed(lines(0))[0]).toMatchObject({ full: false });
    expect(conceptIds(lines(2))).toEqual([]);
    expect(parsed(lines(2))[0]).toMatchObject({ full: false, version: 2 });
    const beyond = lines(99);
    expect(parsed(beyond)[0]).toMatchObject({ full: true });
    expect(conceptIds(beyond)).toHaveLength(5);
  });

  it('UT-CT-048 활성 팩이 없으면 header(version 0·full)·end만 낸다 [CR-41]', () => {
    const all = lines();
    expect(parsed(all)).toEqual([
      expect.objectContaining({ kind: 'header', version: 0, full: true, packs: [] }),
      { kind: 'end', count: 1, sha256: sha256Hex(all[0] as string) },
    ]);
  });

  it('UT-CT-049 CatalogReader는 활성 팩·활성 설치의 KU·MC ID 목록을 내고 없는 개념은 null이다 [FR-CUR-001]', async () => {
    // Arrange
    await installAll(K8S, DB);
    const reader = createCatalogReader(c.fx.db);
    // Act / Assert
    const installs = reader.activeInstalls();
    expect(installs.map((i) => [i.packId, i.version, i.trackId])).toEqual([
      ['db', '2.0.0', 'db'],
      ['k8s', '1.0.0', 'k8s'],
    ]);
    expect(installs[1]?.installId).toBe(
      String(c.fx.db.prepare("SELECT install_id FROM ct_pack WHERE pack_id = 'k8s'").get()?.install_id),
    );
    expect(reader.conceptForItems('k8s.pod')).toEqual({
      conceptId: 'k8s.pod',
      installId: installs[1]?.installId,
      kuIds: ['k8s.pod.k01', 'k8s.pod.k02'],
      misconceptionIds: ['k8s.pod.m01'],
    });
    expect(reader.conceptForItems('k8s.service')).toMatchObject({ kuIds: ['k8s.service.k01'], misconceptionIds: [] });
    expect(reader.conceptForItems('k8s.missing')).toBeNull();
    // 은퇴한 설치는 보이지 않는다: v1.1.0이 pod의 KU를 1개로 줄인다.
    c.put({
      ...K8S,
      version: '1.1.0',
      concepts: K8S.concepts.map((x) => (x.slug === 'pod' ? { ...x, kus: 1, mcs: 1 } : x)),
    });
    c.installer.install(c.req({ kind: 'bundled', track: 'k8s' }));
    await c.installer.idle();
    expect(reader.conceptForItems('k8s.pod')?.kuIds).toEqual(['k8s.pod.k01']);
    expect(reader.activeInstalls().find((i) => i.packId === 'k8s')?.version).toBe('1.1.0');
  });

  it('UT-CT-049 ConceptRef의 prereq_ids는 (prereq ∧ to = 이 개념)의 from 정렬이고 모든 ref가 ConceptRef를 통과한다 [CR-41][FR-CUR-001]', async () => {
    // Arrange
    await installAll(K8S);
    // Act
    const refs = conceptRefsOfActive(c.fx.db);
    // Assert
    const byId = new Map(refs.map((r) => [r.concept_id, r]));
    expect(refs.map((r) => r.concept_id)).toEqual([
      'k8s.config-map',
      'k8s.ingress',
      'k8s.operator',
      'k8s.pod',
      'k8s.service',
    ]);
    expect(byId.get('k8s.ingress')?.prereq_ids).toEqual(['k8s.pod', 'k8s.service']);
    expect(byId.get('k8s.service')?.prereq_ids).toEqual(['k8s.pod']);
    expect(byId.get('k8s.pod')).toMatchObject({ prereq_ids: [], required_for_level: 1, version: 1, track: 'k8s' });
    expect(Object.keys(refs[0] ?? {})).toHaveLength(16);
    for (const r of refs) {
      expect(ConceptRef.safeParse(r).success).toBe(true);
    }
    // sibling·extends 간선은 prereq_ids에 섞이지 않는다.
    c.fx.db
      .prepare(
        "INSERT INTO ct_concept_edge(install_id, from_concept_id, to_concept_id, kind, weight) SELECT install_id, 'k8s.operator', 'k8s.pod', 'sibling', 1 FROM ct_pack WHERE state = 'active'",
      )
      .run();
    expect(conceptRefsOfActive(c.fx.db).find((r) => r.concept_id === 'k8s.pod')?.prereq_ids).toEqual([]);
    expect(rows(c.fx.db, 'SELECT count(*) AS n FROM ct_concept_edge_active')[0]).toEqual({ n: 4 });
  });
});
