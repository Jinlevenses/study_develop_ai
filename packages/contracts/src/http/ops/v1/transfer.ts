import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';

export const ExportBody = S({ op_id: Ulid, since: z.discriminatedUnion('kind', [S({ kind: z.literal('all') }), S({ kind: z.literal('checkpoint'), checkpoint_id: Ulid })]),
  out_dir: z.string().min(1).max(1024).nullable(),                 // null = FATHOM_HOME/exports, 경로 탈출 거부(NFR-SEC-014)
  include: z.array(z.enum(['ledger', 'overlays', 'settings', 'gold', 'markdown_notes'])).min(1).max(5) });
export type ExportBody = z.infer<typeof ExportBody>;
export const ImportBody = S({ op_id: Ulid, path: z.string().min(1).max(1024), mode: z.literal('merge') });
export type ImportBody = z.infer<typeof ImportBody>;
