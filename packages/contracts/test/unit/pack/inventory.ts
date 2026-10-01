// 테스트 전용 AssessmentInventory 샘플 빌더(pack·content 테스트 공용). 모든 모드·레벨 키를 채운다(전수 record).
export const MODES = ['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE'] as const;
export const LEVEL_KEYS = ['1', '2', '3', '4', '5'] as const;
export const FORMATS_OK = ['mcq', 'ox', 'cloze', 'short'] as const;

export const perMode = <T>(v: T): Record<(typeof MODES)[number], T> => ({
  FULL: v,
  JUDGE_ONLY: v,
  LLM_ONLY: v,
  OFFLINE: v,
});

export interface InvConcept {
  concept_id: string;
  level: number;
  tier: 'A' | 'B' | 'C';
  required_for_level: number | null;
  d4_possible: boolean;
  formats_by_mode: Record<(typeof MODES)[number], string[]>;
}

export const invConcept = (
  concept_id: string,
  level: number,
  over: Partial<InvConcept> = {},
  formats: string[] = ['mcq', 'ox', 'cloze'],
): InvConcept => ({
  concept_id,
  level,
  tier: 'A',
  required_for_level: level,
  d4_possible: false,
  formats_by_mode: perMode(formats),
  ...over,
});

export interface Inventory {
  track: string;
  concepts: InvConcept[];
  assessment_pool: Record<string, Record<string, { items: number; formats: string[] }>>;
  cases: { case_id: string; level: number; tracks: string[] }[];
}

/** 모든 레벨 × 모드 풀이 12문항·형식 4종인 인벤토리(필요한 곳만 덮어쓴다). */
export const inventory = (over: Partial<Inventory> = {}): Inventory => ({
  track: 'k8s',
  concepts: [invConcept('k8s.a', 1), invConcept('k8s.b', 1), invConcept('k8s.c', 1)],
  assessment_pool: Object.fromEntries(LEVEL_KEYS.map((k) => [k, perMode({ items: 12, formats: [...FORMATS_OK] })])),
  cases: [],
  ...over,
});
