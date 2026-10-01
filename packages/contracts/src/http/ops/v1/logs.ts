import { z } from 'zod';
import { ServiceName, Ulid } from '../../../common/ids.js';
import { Cursor } from '../../../common/pagination.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof LogLevel>;
export const LogQuery = S({ svc: z.union([ServiceName, z.literal('supervisor')]).optional(), level: LogLevel.optional(), q: z.string().max(200).optional(),
  from: z.coerce.number().int().min(0).optional(), to: z.coerce.number().int().min(0).optional(), correlation_id: Ulid.optional(),
  cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
export type LogQuery = z.infer<typeof LogQuery>;
export const LogLine = S({ ts: EpochMs, level: LogLevel, svc: z.string().max(40), msg: z.string().max(2000), req_id: Ulid.nullable(),
  event: z.string().max(80).nullable(), err_code: z.string().max(40).nullable(), correlation_id: Ulid.nullable(),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/).nullable(), job: z.string().max(40).nullable(), raw: z.boolean() });   // raw = 비 JSON 줄 래핑
export type LogLine = z.infer<typeof LogLine>;
export const LogTailQuery = S({ svc: z.union([ServiceName, z.literal('supervisor')]), n: z.coerce.number().int().min(1).max(5000).default(200) });
export type LogTailQuery = z.infer<typeof LogTailQuery>;
export const LogTail = S({ svc: z.string(), lines: z.array(LogLine).max(5000) });
export type LogTail = z.infer<typeof LogTail>;
