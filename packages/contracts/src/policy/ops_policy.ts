import { z } from 'zod';
import { S } from '../common/schema.js';

// [Brief 결정 §4.8 — CR-43 T1 저작] policy/ops_policy@v1.yaml 의 zod. 값 출처 = ARC-01 §10.4(증분 일 1·스냅샷 주 1·7세대, quiesce 2s·snapshot 30s,
// 로그 14일·50MB, Tripwire 유휴 RSS 400MB·콜드 10s, 디스크 경고 500MB).
export const OpsPolicyV1 = S({
  version: z.literal('ops_policy@v1'),
  backup: S({
    incremental_per_day: z.number().int().min(0),
    snapshot_per_week: z.number().int().min(0),
    generations: z.number().int().min(1),
    quiesce_ms: z.number().int().min(0),
    snapshot_ms: z.number().int().min(1),
  }),
  logs: S({ days: z.number().int().min(1), max_mb_per_svc: z.number().int().min(1) }),
  tripwire: S({ idle_rss_mb: z.number().int().min(1), cold_start_ms: z.number().int().min(1) }),
  disk_warn_mb: z.number().int().min(0),
});
export type OpsPolicyV1 = z.infer<typeof OpsPolicyV1>;
