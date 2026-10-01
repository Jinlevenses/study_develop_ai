import { z } from 'zod';
import { JudgeRequest, JudgeResult } from '../../../ai/judge.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';

export const JudgeRunRoute = defineRoute({
  id: 'ai-gateway.judge.run',
  ifId: 'IF-AI-001',
  method: 'POST',
  path: '/internal/v1/judge/{task_id}',
  allowedCallers: ['content'],
  idempotent: true,
  paginated: false,
  request: { params: S({ task_id: z.string().regex(/^[A-Za-z0-9-]{1,20}$/) }), body: JudgeRequest },
  response: { 200: JudgeResult },
  deadlineMs: 10000,
  freeze: 'D',
  slice: 'R1',
  fr: [
    'FR-AI-004',
    'FR-AI-005',
    'FR-AI-008',
    'FR-AI-009',
    'FR-AI-017',
    'FR-AI-018',
    'FR-QST-017',
    'FR-QST-019',
    'IR-008',
  ],
});
export const AI_JUDGE_ROUTES = [JudgeRunRoute] as const;
