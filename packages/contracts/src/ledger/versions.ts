import type { LedgerEventType } from './envelope.js';

// IF-01 §10.1 — 원장 payload 스키마의 현재 버전(17개 전부 1).
export const CURRENT_SCHEMA_VERSION = {
  'attempt.graded': 1,
  'evidence.upgraded': 1,
  'evidence.regraded': 1,
  'evidence.voided': 1,
  'evidence.weight_adjusted': 1,
  'pretest.answered': 1,
  'lesson.completed': 1,
  'self_assessment.recorded': 1,
  'card.enrolled': 1,
  'card.status_changed': 1,
  'profile.setting_changed': 1,
  'policy.switched': 1,
  'ai_mode.observed': 1,
  'declaration.sealed': 1,
  'promotion.exam_completed': 1,
  'level.promoted': 1,
  'level.provisional_resolved': 1,
} as const satisfies Record<LedgerEventType, number>;
