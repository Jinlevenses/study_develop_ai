import { z } from 'zod';
import { Level } from '../common/domain.js';
import { PackId, SemVer, Sha256Hex, TrackId } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';
import { PackChannel } from '../http/content/v1/catalog.js';

export const FpackManifest = S({
  pack_id: PackId,
  track: TrackId,
  version: SemVer,
  channel: PackChannel,
  schema_v: z.number().int().min(1),
  packc_version: SemVer,
  files: z
    .array(
      S({
        path: z.enum(['bundle.jsonl', 'report.json', 'layout.json']),
        sha256: Sha256Hex,
        bytes: z.number().int().min(0),
      }),
    )
    .length(3),
  merkle_root: Sha256Hex, // = sha256(정렬된 bundle 레코드 해시들의 이진 merkle)
  counts: S({
    concepts: z.number().int(),
    kus: z.number().int(),
    misconceptions: z.number().int(),
    items: z.number().int(),
    cases: z.number().int(),
  }),
  required_for_level: z.record(z.enum(['1', '2', '3', '4', '5']), z.number().int().min(0)),
  offline_cap_level: Level,
  created_at: EpochMs,
});
export type FpackManifest = z.infer<typeof FpackManifest>;
