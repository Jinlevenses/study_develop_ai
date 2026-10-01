import { z } from 'zod';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const ProfileSettingChangedV1 = S({
  key: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/),
  from: z.json(),
  to: z.json(),
  study_day: StudyDay,
}); // IF-LG-11 기록용
export type ProfileSettingChangedV1 = z.infer<typeof ProfileSettingChangedV1>;
