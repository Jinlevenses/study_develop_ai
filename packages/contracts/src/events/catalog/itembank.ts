import { z } from 'zod';
import { ItemId, type ServiceName, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs } from '../../common/time.js';

export const ItembankItemCorrectedV1 = S({
  // IF-EV-07
  item_id: ItemId,
  correction: z.enum(['quarantined', 'demoted', 'key_fixed', 'retired']),
  evidence_policy: z.enum(['void', 'halve', 'keep']),
  basis: z.enum(['regate_g3', 'regate_g5', 'report', 'health', 'overlay', 'pack_upgrade']), // pack_upgrade = 팩 개정으로 정답 키 변경(CR-33, IF-LG-04·멱등 키·ib_correction CHECK와 한 묶음)
  gate_result_id: Ulid, // regate = 게이트 결과 id · report = report_id · overlay = patch_id · health = 판정 id (§15 D-17)
  effective_from: EpochMs, // 이 시각 이후 출제·채점된 증거부터는 새 키 기준
});
export type ItembankItemCorrectedV1 = z.infer<typeof ItembankItemCorrectedV1>;
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
export const ITEMBANK_EVENTS = {
  'itembank.item.corrected': {
    ifId: 'IF-EV-07',
    producer: 'content',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: ItembankItemCorrectedV1 },
  },
} as const satisfies EventCatalog;
