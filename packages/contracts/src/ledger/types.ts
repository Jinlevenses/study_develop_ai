import type { z } from 'zod';
import { CardId, TrackId } from '../common/ids.js';
import type { LedgerEventType } from './envelope.js';
import { AiModeObservedV1 } from './payloads/ai-mode-observed.js';
import { AttemptGradedV1 } from './payloads/attempt-graded.js';
import { CardEnrolledV1 } from './payloads/card-enrolled.js';
import { CardStatusChangedV1 } from './payloads/card-status-changed.js';
import { DeclarationSealedV1 } from './payloads/declaration-sealed.js';
import { EvidenceRegradedV1 } from './payloads/evidence-regraded.js';
import { EvidenceUpgradedV1 } from './payloads/evidence-upgraded.js';
import { EvidenceVoidedV1 } from './payloads/evidence-voided.js';
import { EvidenceWeightAdjustedV1 } from './payloads/evidence-weight-adjusted.js';
import { LessonCompletedV1 } from './payloads/lesson-completed.js';
import { LevelPromotedV1 } from './payloads/level-promoted.js';
import { LevelProvisionalResolvedV1 } from './payloads/level-provisional-resolved.js';
import { PolicySwitchedV1 } from './payloads/policy-switched.js';
import { PretestAnsweredV1 } from './payloads/pretest-answered.js';
import { ProfileSettingChangedV1 } from './payloads/profile-setting-changed.js';
import { PromotionExamCompletedV1 } from './payloads/promotion-exam-completed.js';
import { SelfAssessmentRecordedV1 } from './payloads/self-assessment-recorded.js';

// 2차 검증 표: LEDGER_PAYLOADS[type][schema_version] (IF-01 §10.2, upcast 후)
export const LEDGER_PAYLOADS = {
  'attempt.graded': { 1: AttemptGradedV1 },
  'evidence.upgraded': { 1: EvidenceUpgradedV1 },
  'evidence.regraded': { 1: EvidenceRegradedV1 },
  'evidence.voided': { 1: EvidenceVoidedV1 },
  'evidence.weight_adjusted': { 1: EvidenceWeightAdjustedV1 },
  'pretest.answered': { 1: PretestAnsweredV1 },
  'lesson.completed': { 1: LessonCompletedV1 },
  'self_assessment.recorded': { 1: SelfAssessmentRecordedV1 },
  'card.enrolled': { 1: CardEnrolledV1 },
  'card.status_changed': { 1: CardStatusChangedV1 },
  'profile.setting_changed': { 1: ProfileSettingChangedV1 },
  'policy.switched': { 1: PolicySwitchedV1 },
  'ai_mode.observed': { 1: AiModeObservedV1 },
  'declaration.sealed': { 1: DeclarationSealedV1 },
  'promotion.exam_completed': { 1: PromotionExamCompletedV1 },
  'level.promoted': { 1: LevelPromotedV1 },
  'level.provisional_resolved': { 1: LevelProvisionalResolvedV1 },
} as const satisfies Record<LedgerEventType, Record<number, z.ZodType>>;

// ---------------------------------------------------------------------------------------------------------------------
// 원장 멱등 키 형식(IF-01 §10.1 표, IF-LG-01~17). 런타임 문자열 조립은 이 파일 안에서만 한다.
// ---------------------------------------------------------------------------------------------------------------------
const U = '[0-9A-HJKMNP-TV-Z]{26}';
const BASIS = '(regate_g3|regate_g5|report|health|overlay|pack_upgrade)'; // = EvidenceVoidedV1.basis (CR-33)
const TRACK = TrackId.options.join('|');

export const LEDGER_KEY_PATTERNS = {
  'attempt.graded': new RegExp(`^verdict:${U}$`),
  'evidence.upgraded': new RegExp(`^verdict:${U}$`),
  'evidence.regraded': new RegExp(`^verdict:${U}$`),
  'evidence.voided': new RegExp(`^corr:[^:]+:${BASIS}:${U}$`),
  'evidence.weight_adjusted': new RegExp(`^(corr:[^:]+:${BASIS}:${U}|recalc:ps_[0-9a-f]{16}:${U})$`),
  'pretest.answered': new RegExp(`^att:${U}$`),
  'lesson.completed': new RegExp(`^cmd:${U}:(theory|code|core)$`),
  'self_assessment.recorded': new RegExp(`^cmd:${U}(:[a-z0-9_.-]{1,60})?$`),
  'card.enrolled': /^card:(.+)$/, // 나머지는 CardId로 별도 검증
  'card.status_changed': new RegExp(`^cmd:${U}$`),
  'profile.setting_changed': new RegExp(`^cmd:${U}:[a-z_]+(\\.[a-z_]+)*$`),
  'policy.switched': /^policy:ps_[0-9a-f]{16}$/,
  'ai_mode.observed': new RegExp(`^aimode:${U}$`),
  'declaration.sealed': new RegExp(`^cmd:${U}$`),
  'promotion.exam_completed': new RegExp(`^exam:${U}$`),
  'level.promoted': new RegExp(`^promo:(${TRACK}):[1-5]$`),
  'level.provisional_resolved': new RegExp(`^promo-res:(${TRACK}):[1-5]:\\d{1,4}$`),
} as const satisfies Record<LedgerEventType, RegExp>;

export function isValidLedgerIdempotencyKey(type: LedgerEventType, key: string): boolean {
  const m = LEDGER_KEY_PATTERNS[type].exec(key);
  if (m === null) {
    return false;
  }
  if (type === 'card.enrolled') {
    return CardId.safeParse(m[1]).success;
  }
  return true;
}
