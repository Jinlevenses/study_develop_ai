import type { StudyDayContext } from '../../application/ledger/ports.js';

// FR-PRG-027 — 기본 일 경계 04:00. 사용자 설정(lr_setting)은 IT-03 [Brief 결정].
export const DEFAULT_DAY_BOUNDARY_MINUTES = 240;

/** 시스템 시간대 + 기본 경계. 학습일은 이벤트 생성 시 payload에 내장되므로 이 값은 생성 시점에만 읽는다. */
export function systemStudyDayContext(): StudyDayContext {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayBoundaryMinutes: DEFAULT_DAY_BOUNDARY_MINUTES,
  };
}
