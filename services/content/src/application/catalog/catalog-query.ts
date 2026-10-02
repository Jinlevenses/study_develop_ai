import type { Cursor } from '@fathom/contracts/common/pagination';
import { Page } from '@fathom/contracts/common/pagination';
import { COMMON_ERRORS, commonErrorCode } from '@fathom/contracts/common/errors';
import {
  ConceptSummary,
  InstalledPackList,
  PackKpi,
  TrackCatalog,
} from '@fathom/contracts/http/content/v1/catalog';
import { FpackManifest } from '@fathom/contracts/pack/manifest';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { AppError, err, ok } from '@fathom/shared-kernel/errors/errors';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { z } from 'zod';
import { decodeConceptCursor, encodeConceptCursor } from '../../domain/catalog/cursor.js';
import {
  SELECT_ACTIVE_LEVEL_COUNTS,
  SELECT_ACTIVE_PACKS,
  SELECT_ACTIVE_TRACK_PRESENT,
  SELECT_ACTIVE_TRACKS,
  SELECT_TRACK_CONCEPTS_PAGE,
} from '../../infra/db/ct-catalog-read.sql.js';
import { catalogFault } from './errors.js';
import type { Row } from './row-read.js';
import { int, intOrNull, str, strOrNull } from './row-read.js';

// PGM-CT-003 조회(IF-CT-003~005) — 활성 뷰 `ct_*_active`만 읽는다.
// 오버레이 합성(`ct_overlay_head`)은 IT-01에서 하지 않는다: 오버레이 쓰기 경로 = IT-03이라 그때까지 활성 설치 행이 곧 서빙 값이다.

const DEFAULT_LIMIT = 200;
const ReportSlice = z.looseObject({
  kpi: PackKpi,
  tier_counts: z.looseObject({ A: z.number().int(), B: z.number().int(), C: z.number().int() }),
  cap_blockers: z.array(z.looseObject({})),
});

export type TrackConceptsInput = { readonly level?: number; readonly cursor?: Cursor; readonly limit?: number };
export interface CatalogQuery {
  listPacks(): InstalledPackList;
  listTracks(): TrackCatalog;
  listTrackConcepts(track: string, query: TrackConceptsInput): Result<PageOf<ConceptSummary>, AppError>;
}
type PageOf<T> = { readonly items: readonly T[]; readonly next_cursor: string | null };

function reportOf(row: Row): z.infer<typeof ReportSlice> {
  return ReportSlice.parse(parseJsonStrict(str(row, 'report_json')));
}

function jsonArray(row: Row, key: string): unknown[] {
  const v = parseJsonStrict(str(row, key));
  if (!Array.isArray(v)) {
    throw new Error(`invariant: column ${key} is not a JSON array`);
  }
  return v;
}

function conceptSummary(row: Row): ConceptSummary {
  return ConceptSummary.parse({
    concept_id: str(row, 'concept_id'),
    track: str(row, 'track_id'),
    level: int(row, 'level'),
    tier: str(row, 'tier'),
    knowledge_type: str(row, 'knowledge_type'),
    title_ko: str(row, 'title_ko'),
    title_en: str(row, 'title_en'),
    summary_ko: str(row, 'summary_ko'),
    aliases: jsonArray(row, 'aliases_json'),
    required_for_level: intOrNull(row, 'required_for_level'),
    deprecated_by: strOrNull(row, 'deprecated_by'),
    volatility: str(row, 'volatility'),
    tags: jsonArray(row, 'tags_json'),
  });
}

const levelAtLeastOne = (n: number): number => Math.max(1, n);

export function createCatalogQuery(db: SqlitePort): CatalogQuery {
  return {
    listPacks(): InstalledPackList {
      const packs = db
        .prepare(SELECT_ACTIVE_PACKS)
        .all()
        .map((row) => {
          const report = reportOf(row);
          const manifest = FpackManifest.parse(parseJsonStrict(str(row, 'manifest_json')));
          return {
            pack_id: str(row, 'pack_id'),
            track: str(row, 'track_id'),
            version: str(row, 'version'),
            channel: str(row, 'channel'),
            manifest_hash: str(row, 'manifest_hash'),
            merkle_root: str(row, 'merkle_root'),
            activated_at: int(row, 'activated_at'),
            counts: manifest.counts,
            report: { kpi: report.kpi, tier_counts: report.tier_counts, cap_blockers: report.cap_blockers },
          };
        });
      return InstalledPackList.parse({ packs });
    },

    listTracks(): TrackCatalog {
      const counts = new Map<string, [number, number, number, number, number]>();
      const declared = new Map<string, number>();
      for (const r of db.prepare(SELECT_ACTIVE_LEVEL_COUNTS).all()) {
        const key = `${str(r, 'install_id')}/${str(r, 'track_id')}`;
        const tuple = counts.get(key) ?? [0, 0, 0, 0, 0];
        const level = int(r, 'level');
        tuple[level - 1] = int(r, 'n');
        counts.set(key, tuple);
        declared.set(key, Math.max(declared.get(key) ?? 0, level));
      }
      const tracks = db
        .prepare(SELECT_ACTIVE_TRACKS)
        .all()
        .map((row) => {
          const key = `${str(row, 'install_id')}/${str(row, 'track_id')}`;
          const oracle = levelAtLeastOne(int(row, 'oracle_cap_level'));
          return {
            track: str(row, 'track_id'),
            title_ko: str(row, 'name_ko'),
            title_en: str(row, 'name_en'),
            concept_counts: counts.get(key) ?? [0, 0, 0, 0, 0],
            // Level 하한 1 보정 — cap 0은 1로 올려 표시한다. display = oracle(CR-22: Brief 콘텐츠 전까지 오라클 값).
            cap: {
              declared: levelAtLeastOne(declared.get(key) ?? 0),
              offline: levelAtLeastOne(int(row, 'offline_cap_level')),
              oracle,
              display: oracle,
            },
            kpi: reportOf(row).kpi,
            pack: { pack_id: str(row, 'pack_id'), version: str(row, 'version'), channel: str(row, 'channel') },
          };
        });
      return TrackCatalog.parse({ tracks });
    },

    listTrackConcepts(track: string, query: TrackConceptsInput): Result<PageOf<ConceptSummary>, AppError> {
      if (db.prepare(SELECT_ACTIVE_TRACK_PRESENT).get({ track_id: track }) === undefined) {
        return err(catalogFault('track_not_found', `track ${track}`));
      }
      let cursorLevel = 0;
      let cursorId = '';
      if (query.cursor !== undefined) {
        const decoded = decodeConceptCursor(query.cursor);
        if (decoded === null) {
          return err(
            new AppError(commonErrorCode('CT', 'VAL-903'), COMMON_ERRORS['VAL-903'].status, 'cursor is invalid'),
          );
        }
        cursorLevel = decoded.level;
        cursorId = decoded.concept_id;
      }
      const limit = query.limit ?? DEFAULT_LIMIT;
      const rows = db.prepare(SELECT_TRACK_CONCEPTS_PAGE).all({
        track_id: track,
        level: query.level ?? null,
        cursor_level: cursorLevel,
        cursor_id: cursorId,
        limit: limit + 1,
      });
      const pageRows = rows.slice(0, limit);
      const items = pageRows.map(conceptSummary);
      const last = items[items.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeConceptCursor({ level: last.level, concept_id: last.concept_id })
          : null;
      return ok(Page(ConceptSummary).parse({ items, next_cursor: nextCursor }));
    },
  };
}
