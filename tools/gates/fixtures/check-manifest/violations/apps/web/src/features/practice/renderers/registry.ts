export const RENDERERS = {
  lesson: { component: 'Lesson', e2e_id: 'E2E-301' },
  mcq: { component: 'Mcq', e2e_id: 'E2E-304' },
  bogus: { component: 'Bogus', e2e_id: 'E2E-399' }, // EXPECT[manifest/renderer-key]
} as const;
