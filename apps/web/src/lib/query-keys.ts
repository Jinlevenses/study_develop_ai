import type { TrackId } from '@fathom/contracts/common/ids';

/** query key 팩토리(STD-WEB-10) — 문자열 리터럴 키는 이 파일에만 둔다. `*All()`은 접두 무효화용. */
export const qk = {
  home: (): readonly ['home'] => ['home'],
  tracks: (): readonly ['tracks'] => ['tracks'],
  track: (t: TrackId): readonly ['track', TrackId] => ['track', t],
  trackAll: (): readonly ['track'] => ['track'],
  concept: (id: string): readonly ['concept', string] => ['concept', id],
  conceptAll: (): readonly ['concept'] => ['concept'],
  map: (): readonly ['map'] => ['map'],
  curationConflicts: (): readonly ['curation', 'conflicts'] => ['curation', 'conflicts'],
  curationReports: (): readonly ['curation', 'reports'] => ['curation', 'reports'],
  imports: (): readonly ['imports'] => ['imports'],
  import: (id: string): readonly ['import', string] => ['import', id],
  verdict: (id: string): readonly ['verdict', string] => ['verdict', id],
  session: (id: string): readonly ['session', string] => ['session', id],
  sessionAll: (): readonly ['session'] => ['session'],
  evidence: (id: string): readonly ['evidence', string] => ['evidence', id],
  evidenceAll: (): readonly ['evidence'] => ['evidence'],
  reviewWeekly: (): readonly ['review', 'weekly'] => ['review', 'weekly'],
  promotion: (t: TrackId): readonly ['promotion', TrackId] => ['promotion', t],
  aiStatus: (): readonly ['ai', 'status'] => ['ai', 'status'],
  aiWorkOrders: (): readonly ['ai', 'work-orders'] => ['ai', 'work-orders'],
  aiUsage: (): readonly ['ai', 'usage'] => ['ai', 'usage'],
  aiCalibration: (): readonly ['ai', 'calibration'] => ['ai', 'calibration'],
  opsHealth: (): readonly ['ops', 'health'] => ['ops', 'health'],
  opsBackups: (): readonly ['ops', 'backups'] => ['ops', 'backups'],
} as const;
