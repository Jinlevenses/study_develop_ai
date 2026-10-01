import { z } from 'zod';
import { GenerateTaskId } from './tasks.js';
import { SemVer, Sha256Hex, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';

export const StreamMeta  = S({ ref: Ulid, task_id: GenerateTaskId, prompt_version: SemVer, provider_kind: z.enum(['llm_api', 'llm_cli', 'local_llm']), started_at: EpochMs });
export type StreamMeta = z.infer<typeof StreamMeta>;
export const StreamDelta = S({ seq: z.number().int().min(1), text: z.string().max(4000) });
export type StreamDelta = z.infer<typeof StreamDelta>;
export const StreamDone  = S({ seq: z.number().int().min(1), finish: z.enum(['stop', 'length', 'filtered']), text_sha256: Sha256Hex, chars: z.number().int().min(0),
  output: z.record(z.string(), z.unknown()).nullable() });          // 구조화 출력(AI-G07 = {move, reveals_answer:false}), 없으면 null
export type StreamDone = z.infer<typeof StreamDone>;
export const StreamError = S({ seq: z.number().int().min(1), code: z.enum(['AI-DEP-001', 'AI-DEP-002', 'AI-DEP-003']), fallback_text_md: z.string().max(4000).nullable() });
export type StreamError = z.infer<typeof StreamError>;
// SSE 프레임:  id: <seq>\n event: meta|delta|done|error\n data: <JSON>\n\n   (meta의 id는 0)
