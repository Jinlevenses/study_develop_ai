import { z } from 'zod';
import { GenerateRequest, GenerateResult } from '../../../ai/generate.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';

export const GenerateRunRoute = defineRoute({
  id: 'ai-gateway.generate.run',
  ifId: 'IF-AI-002',
  method: 'POST',
  path: '/internal/v1/generate/{task_id}',
  allowedCallers: ['content'],
  idempotent: true,
  paginated: false,
  request: { params: S({ task_id: z.string().regex(/^[A-Za-z0-9-]{1,20}$/) }), body: GenerateRequest },
  response: { 200: GenerateResult },
  deadlineMs: 120000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-004', 'FR-AI-006', 'FR-AI-020', 'FR-AI-023', 'FR-STD-020', 'IR-001~007', 'IR-018'],
});
export const AI_GENERATE_ROUTES = [GenerateRunRoute] as const;
