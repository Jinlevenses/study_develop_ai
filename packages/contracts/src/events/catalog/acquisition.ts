import { z } from 'zod';
import { type ServiceName, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';

export const AcquisitionImportStagedV1 = S({
  // IF-EV-04
  job_id: Ulid,
  source_kind: z.enum(['url', 'paste', 'file', 'inbox']),
  diff_summary: S({ concepts: z.number().int(), kus: z.number().int(), items: z.number().int() }),
  requires_approval: z.boolean(),
});
export type AcquisitionImportStagedV1 = z.infer<typeof AcquisitionImportStagedV1>;
type EventCatalog = Readonly<
  Record<
    string,
    {
      readonly ifId: string;
      readonly producer: z.infer<typeof ServiceName>;
      readonly freeze: 'D' | 'O';
      readonly slice: 'R0' | 'R1' | 'R2' | 'R3';
      readonly versions: Readonly<Record<number, z.ZodType>>;
    }
  >
>; // 파일 비공개
// IF-01 §9.3 카탈로그 표(v·생산·동결·슬라이스) 전사 — T-00-10 contracts:gen이 이 맵을 import해 registry.gen.ts를 만든다.
export const ACQUISITION_EVENTS = {
  'acquisition.import.staged': {
    ifId: 'IF-EV-04',
    producer: 'content',
    freeze: 'O',
    slice: 'R2',
    versions: { 1: AcquisitionImportStagedV1 },
  },
} as const satisfies EventCatalog;
