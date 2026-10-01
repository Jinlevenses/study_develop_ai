import { ConceptId } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EvidencePanel, LedgerEventSummary } from '../../learning/v1/learner.js';

// 하위 = IF-LR-041
export const EvidenceGetRoute = defineRoute({
  id: 'gateway.evidence.get',
  ifId: 'IF-GW-056',
  method: 'GET',
  path: '/api/v1/evidence/{concept_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }) },
  response: { 200: EvidencePanel },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-007', 'FR-PRG-009', 'FR-PRG-010'],
});
// 하위 = IF-LR-042
export const EvidenceEventsRoute = defineRoute({
  id: 'gateway.evidence.events',
  ifId: 'IF-GW-057',
  method: 'GET',
  path: '/api/v1/evidence/{concept_id}/events',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { params: S({ concept_id: ConceptId }), query: PageQuery },
  response: { 200: Page(LedgerEventSummary) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-007', 'FR-PRG-001'],
});
export const GW_EVIDENCE_ROUTES = [EvidenceGetRoute, EvidenceEventsRoute] as const;
