// DCP-01 §6.1 — packs/<track>/pack.yaml.
import { SemVer, TrackId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { TrackGroup } from './common.js';

export const PackYaml = z
  .object({
    schema_v: z.literal(1),
    id: TrackId, // = 디렉터리 이름
    version: SemVer,
    channel: z.literal('seed'),
    track: z
      .object({
        id: TrackId, // = id
        name_ko: z.string().min(1).max(30),
        name_en: z.string().min(1).max(40),
        track_group: TrackGroup, // data는 'app'(DN-08)
        sort_order: z.int().min(1).max(99),
        summary_ko: z.string().min(10).max(300),
      })
      .strict(),
    requires: z
      .object({
        packc: z.string(), // semver 범위, 예 ">=0.1.0 <1.0.0"
        policy: z.partialRecord(z.enum(['mastery_rules', 'gate_thresholds']), z.string().regex(/^v\d+$/)),
      })
      .strict(),
    content_license: z.literal('repo'),
  })
  .strict();
export type PackYaml = z.infer<typeof PackYaml>;
