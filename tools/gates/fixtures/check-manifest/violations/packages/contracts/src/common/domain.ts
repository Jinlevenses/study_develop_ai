import { z } from 'zod';

export const FormatId = z.enum([
  'embedded',
  'ox',
  'mcq',
  'cloze',
  'blank_note',
  'digging',
]);
export type FormatId = z.infer<typeof FormatId>;
