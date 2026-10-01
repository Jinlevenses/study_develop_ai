import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { Operation } from './operations.js';

export const ExportBody = S({
  op_id: Ulid,
  since: z.discriminatedUnion('kind', [
    S({ kind: z.literal('all') }),
    S({ kind: z.literal('checkpoint'), checkpoint_id: Ulid }),
  ]),
  out_dir: z.string().min(1).max(1024).nullable(), // null = FATHOM_HOME/exports, 경로 탈출 거부(NFR-SEC-014)
  include: z
    .array(z.enum(['ledger', 'overlays', 'settings', 'gold', 'markdown_notes']))
    .min(1)
    .max(5),
});
export type ExportBody = z.infer<typeof ExportBody>;
export const ImportBody = S({ op_id: Ulid, path: z.string().min(1).max(1024), mode: z.literal('merge') });
export type ImportBody = z.infer<typeof ImportBody>;

// idem = op_id
export const ExportsCreateRoute = defineRoute({
  id: 'ops.exports.create',
  ifId: 'IF-OP-020',
  method: 'POST',
  path: '/internal/v1/exports',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: ExportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022', 'FR-DSH-014'],
});
// idem = op_id
export const ImportsCreateRoute = defineRoute({
  id: 'ops.imports.create',
  ifId: 'IF-OP-021',
  method: 'POST',
  path: '/internal/v1/imports',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: ImportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022', 'FR-PRG-003'],
});
export const OP_TRANSFER_ROUTES = [ExportsCreateRoute, ImportsCreateRoute] as const;
