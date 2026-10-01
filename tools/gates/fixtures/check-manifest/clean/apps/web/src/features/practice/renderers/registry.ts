// 렌더러 레지스트리: 첫 `= {` 객체 리터럴의 깊이 1 키 = FormatId·BlockKind
export const RENDERERS = {
  lesson: { component: 'Lesson', e2e_id: 'E2E-301' },
  ox: { component: 'Ox', e2e_id: 'E2E-303' },
  mcq: { component: 'Mcq', e2e_id: 'E2E-304' },
  cloze: { component: 'Cloze', e2e_id: 'E2E-304' },
  lab: { component: 'Lab', e2e_id: 'E2E-310' },
  blank_note: { component: 'BlankNote', e2e_id: 'E2E-313' },
  dialog: { component: 'Dialog', e2e_id: 'E2E-314' },
} as const;
