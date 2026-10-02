import type { FormatId } from '@fathom/contracts/common/domain';
import type { BlockKind } from '@fathom/contracts/http/learning/v1/sessions';
import type { ComponentType } from 'react';
import type { HotkeyScope } from '../../../lib/hotkeys.js';
import { NotYetRenderer } from '../../../lib/not-yet-renderer.js';

// 병합 핫스팟 — 키 목록(FormatId 33 ∪ BlockKind 10 = 41)은 이 Task가 최종이다. feature WP는 component 값만 바꾼다.
// 아래 RENDERERS는 이 파일에서 처음 나오는 객체 리터럴이어야 한다(check-manifest가 키와 e2e_id를 토큰으로 읽는다).
export type RendererKey = FormatId | BlockKind;

export interface RendererProps {
  readonly blockId: string;
  readonly itemKey: string | null;
  /** 플레이어가 `RENDERERS[key]`를 렌더할 때 함께 넘기는 키(자리표시 렌더러가 표시한다). */
  readonly rendererKey?: string;
}

export interface RendererEntry {
  readonly component: ComponentType<RendererProps>;
  readonly kbd: HotkeyScope;
  readonly offline: 'deterministic' | 'self' | 'pending' | 'alt_evidence';
  readonly e2e_id: string | null;
}

export const RENDERERS = {
  embedded: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-301' },
  ox: { component: NotYetRenderer, kbd: 'ox', offline: 'deterministic', e2e_id: 'E2E-303' },
  mcq: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-304' },
  cloze: { component: NotYetRenderer, kbd: 'cloze', offline: 'deterministic', e2e_id: 'E2E-304' },
  short: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: 'E2E-304' },
  matching: { component: NotYetRenderer, kbd: 'matching', offline: 'deterministic', e2e_id: 'E2E-304' },
  code_task: { component: NotYetRenderer, kbd: 'editor', offline: 'deterministic', e2e_id: 'E2E-310' },
  blank_note: { component: NotYetRenderer, kbd: 'note', offline: 'self', e2e_id: 'E2E-313' },
  digging_d4_mcq: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-314' },
  error_find: { component: NotYetRenderer, kbd: 'bugline', offline: 'deterministic', e2e_id: 'E2E-306' },
  confusable: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-307' },
  fermi: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: 'E2E-308' },
  cond_reversal: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-309' },
  infra_lite: { component: NotYetRenderer, kbd: 'editor', offline: 'deterministic', e2e_id: 'E2E-312' },
  kata: { component: NotYetRenderer, kbd: 'editor', offline: 'deterministic', e2e_id: 'E2E-311' },
  audit: { component: NotYetRenderer, kbd: 'bugline', offline: 'deterministic', e2e_id: 'E2E-316' },
  case_decision: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-319' },
  code_predict: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: 'E2E-305' },
  sql_task: { component: NotYetRenderer, kbd: 'editor', offline: 'deterministic', e2e_id: 'E2E-310' },
  essay: { component: NotYetRenderer, kbd: 'note', offline: 'self', e2e_id: 'E2E-321' },
  digging: { component: NotYetRenderer, kbd: 'dialog', offline: 'alt_evidence', e2e_id: 'E2E-314' },
  feynman: { component: NotYetRenderer, kbd: 'dialog', offline: 'self', e2e_id: 'E2E-315' },
  pr_review: { component: NotYetRenderer, kbd: 'bugline', offline: 'deterministic', e2e_id: 'E2E-317' },
  reverse_item: { component: NotYetRenderer, kbd: 'form', offline: 'pending', e2e_id: 'E2E-318' },
  artifact: { component: NotYetRenderer, kbd: 'note', offline: 'self', e2e_id: 'E2E-320' },
  case_postmortem: { component: NotYetRenderer, kbd: 'note', offline: 'self', e2e_id: 'E2E-319' },
  micro_judgment: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-319' },
  ml_predict: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: null },
  mcq_multi: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-304' },
  order: { component: NotYetRenderer, kbd: 'reorder', offline: 'deterministic', e2e_id: 'E2E-304' },
  parsons: { component: NotYetRenderer, kbd: 'reorder', offline: 'deterministic', e2e_id: 'E2E-310' },
  log_read: { component: NotYetRenderer, kbd: 'choice', offline: 'deterministic', e2e_id: 'E2E-306' },
  config_review: { component: NotYetRenderer, kbd: 'bugline', offline: 'deterministic', e2e_id: 'E2E-306' },
  lesson: { component: NotYetRenderer, kbd: 'lesson', offline: 'deterministic', e2e_id: 'E2E-301' },
  items: { component: NotYetRenderer, kbd: 'player', offline: 'deterministic', e2e_id: 'E2E-302' },
  dialog: { component: NotYetRenderer, kbd: 'dialog', offline: 'alt_evidence', e2e_id: 'E2E-314' },
  lab: { component: NotYetRenderer, kbd: 'editor', offline: 'deterministic', e2e_id: 'E2E-310' },
  case: { component: NotYetRenderer, kbd: 'player', offline: 'alt_evidence', e2e_id: 'E2E-319' },
  jol: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: null },
  reflection: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: null },
  triage: { component: NotYetRenderer, kbd: 'form', offline: 'deterministic', e2e_id: null },
} as const satisfies Record<RendererKey, RendererEntry>;
