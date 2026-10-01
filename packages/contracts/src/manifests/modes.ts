import { z } from 'zod';
import { ModeId } from '../common/domain.js';
import { S } from '../common/schema.js';

export const Ur14Family = z.enum(['개념이해', '실습', '문제', '개념 디깅', 'OX', '백지노트']); // UR-14 명칭 그대로
export type Ur14Family = z.infer<typeof Ur14Family>;
export const ModeEntry = S({
  mode_id: ModeId,
  name_ko: z.string().min(1).max(40),
  ur14_family: Ur14Family,
  offline_path: z.string().min(1).max(200),
  e2e_ids: z
    .array(z.string().regex(/^(E2E-\d{3}|SCN-\d{2})$/))
    .min(1)
    .max(4),
  status: z.enum(['included', 'deferred']),
});
export type ModeEntry = z.infer<typeof ModeEntry>;
export const ModesManifest = S({ version: z.literal(1), modes: z.array(ModeEntry).length(21) }).refine(
  (m) => new Set(m.modes.map((x) => x.mode_id)).size === 21,
  'mode_id must be unique',
);
export type ModesManifest = z.infer<typeof ModesManifest>;
