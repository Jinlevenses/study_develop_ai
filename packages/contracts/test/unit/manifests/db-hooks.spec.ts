import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DB_EXT_HOOKS, DB_EXT_TABLES, DB_NAME_HOOKS } from '../../../src/db-hooks.js';

// 독립 기대표: DB-01 §3.5 이름 훅 표(12그룹·29열)
const EXPECTED_NAME_HOOKS: Record<string, { table: string; columns: string[] }> = {
  event: {
    table: 'lr_event',
    columns: ['event_id', 'device_id', 'device_seq', 'client_ts', 'idempotency_key', 'experiment_arm'],
  },
  judge_log: { table: 'ai_judge_log', columns: ['probabilities', 'input_hash', 'model_version'] },
  item: { table: 'ib_item', columns: ['source_kind', 'stem_family', 'gate_status', 'defect_manifest'] },
  card: { table: 'lr_card_state', columns: ['response_mode'] },
  misconception: { table: 'ct_misconception', columns: ['meta_family', 'status'] },
  ku: { table: 'ct_ku', columns: ['valid_as_of', 'deprecated_by', 'scope'] },
  concept: { table: 'ct_concept', columns: ['volatility', 'required_for_level'] },
  track: { table: 'ct_track', columns: ['offline_cap_level'] },
  case: { table: 'ct_case', columns: ['variant_params', 'root_cause_pool', 'best_if', 'contested'] },
  overlay: { table: 'ct_overlay_event', columns: ['base_version'] },
  pack: { table: 'ct_pack', columns: ['channel'] },
  inbox: { table: 'aq_inbox_item', columns: ['source_kind'] },
};

describe('db-hooks', () => {
  it('UT-CON-005 DB_NAME_HOOKS는 DB-01 §3.5 이름 훅 12그룹·29열과 일치하고 DB_EXT_TABLES는 ext 열 기준이다 [DR-020]', async () => {
    expect(DB_NAME_HOOKS).toHaveLength(12);
    expect(DB_NAME_HOOKS.map((h) => h.hook).sort()).toEqual(Object.keys(EXPECTED_NAME_HOOKS).sort());
    let columns = 0;
    for (const h of DB_NAME_HOOKS) {
      const want = EXPECTED_NAME_HOOKS[h.hook];
      expect(want, h.hook).toBeDefined();
      expect(h.table, h.hook).toBe(want?.table);
      expect([...h.columns], h.hook).toEqual(want?.columns);
      expect(h.file, h.hook).toMatch(
        /^services\/(learning|content|ai-gateway)\/migrations\/[a-z-]+\/0001_[a-z_]+\.sql$/,
      );
      columns += h.columns.length;
    }
    expect(columns).toBe(29);
    // 열 수 분포: lr_event 6 · ai_judge_log 3 · ib_item 4 · lr_card_state 1 · ct_misconception 2 · ct_ku 3 · ct_concept 2 · ct_track 1 · ct_case 4 · ct_overlay_event 1 · ct_pack 1 · aq_inbox_item 1
    expect(DB_NAME_HOOKS.map((h) => h.columns.length)).toEqual([6, 3, 4, 1, 2, 3, 2, 1, 4, 1, 1, 1]);

    // ext 훅 7행
    expect(DB_EXT_HOOKS).toHaveLength(7);
    for (const h of DB_EXT_HOOKS) {
      expect(h.tables.length, h.hook).toBeGreaterThan(0);
      expect(h.keys.length, h.hook).toBeGreaterThan(0);
      expect(h.deferred, h.hook).toMatch(/^DEF-\d{2}(·\d{2})*$/);
      for (const k of h.keys) {
        expect(k, h.hook).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    }
    expect(DB_EXT_HOOKS.flatMap((h) => [...h.keys]).sort()).toEqual(
      [
        'case.world_id',
        'case.episode_seq',
        'case.expert_path',
        'epa.refs',
        'anchor.set_id',
        'anchor.run_id',
        'mutant.list',
        'sct.panel_distribution',
        'stimulus.id',
        'stimulus.ladder',
        'graph.ref',
        'pack.signature',
        'pack.direction',
      ].sort(),
    );

    // ext 테이블: 분류가 아니라 ext 열 기준
    const tables = DB_EXT_TABLES.map((t) => t.table);
    expect(tables).toContain('lr_event');
    expect(tables).toContain('ct_overlay_event');
    expect(tables).not.toContain('ct_path'); // E지만 ext 열이 '—'
    expect(tables).not.toContain('ct_pack_active');
    expect(new Set(tables).size).toBe(tables.length);
    expect(DB_EXT_TABLES).toHaveLength(38);
    for (const t of DB_EXT_TABLES) {
      expect(['content.db', 'learning.db', 'ai.db', 'ops.db']).toContain(t.db);
    }
    // 이름 훅 테이블 중 ext를 갖는 테이블은 목록에 있다.
    for (const t of [
      'lr_event',
      'ct_pack',
      'ct_track',
      'ct_concept',
      'ct_ku',
      'ct_misconception',
      'ct_case',
      'ib_item',
      'aq_inbox_item',
    ]) {
      expect(tables, t).toContain(t);
    }

    // lint:hooks가 어휘 분석으로 읽는 파일 — 리터럴만 허용(템플릿·spread·호출·zod import 0)
    const src = await readFile(fileURLToPath(new URL('../../../src/db-hooks.ts', import.meta.url)), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/`/);
    expect(code).not.toMatch(/\.\.\./);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\bzod\b/);
    expect(code).not.toMatch(/\w\s*\(/); // 함수 호출 0
  });
});
