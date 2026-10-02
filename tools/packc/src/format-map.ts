// 형식 어휘 표 — DCP-01 §6.5.1(저작 25종) · IF-01 FormatId(33종). CR-36으로 저작 이름 = FormatId이므로 이름 매핑표는 항등이다.
// (PGM-PACKC-012, FR-STD-033, FR-QST-007). 모듈 로드 시 AUTHORING ∪ NON_AUTHORING = FormatId.options, 교집합 0을 단언한다.
import { FormatId } from '@fathom/contracts/common/domain';
import type { z } from 'zod';

type FormatIdT = z.infer<typeof FormatId>;

/** DCP §6.5.1 저작 형식 25종(`code_task`·`sql_task`·`infra_lite`는 랩 기반이라 items 파일에는 쓰지 않는다). */
export const AUTHORING_FORMATS = [
  'ox',
  'mcq',
  'mcq_multi',
  'cloze',
  'short',
  'order',
  'matching',
  'code_predict',
  'error_find',
  'parsons',
  'code_task',
  'sql_task',
  'infra_lite',
  'config_review',
  'log_read',
  'cond_reversal',
  'fermi',
  'blank_note',
  'essay',
  'digging',
  'digging_d4_mcq',
  'feynman',
  'audit',
  'pr_review',
  'embedded',
] as const satisfies readonly FormatIdT[];

/** 런타임·모드 전용 8종 — 저작 금지(R-FMT). */
export const NON_AUTHORING_FORMATS = [
  'case_decision',
  'case_postmortem',
  'artifact',
  'reverse_item',
  'micro_judgment',
  'ml_predict',
  'confusable',
  'kata',
] as const satisfies readonly FormatIdT[];

export type FormatMeta = {
  readonly response_mode: 'recognition' | 'production';
  readonly n_options: { readonly min: number; readonly max: number };
  readonly tiers: readonly ('A' | 'B' | 'C')[];
};

const AB = ['A', 'B'] as const;
const A = ['A'] as const;
const ABC = ['A', 'B', 'C'] as const;
const NONE = { min: 0, max: 0 } as const;

/** §6.5.1 표 열(기본 response_mode · n_options · 허용 티어) 그대로. */
export const FORMAT_META = {
  ox: { response_mode: 'recognition', n_options: { min: 2, max: 2 }, tiers: AB },
  mcq: { response_mode: 'recognition', n_options: { min: 3, max: 5 }, tiers: AB },
  mcq_multi: { response_mode: 'recognition', n_options: { min: 4, max: 6 }, tiers: A },
  cloze: { response_mode: 'production', n_options: NONE, tiers: AB },
  short: { response_mode: 'production', n_options: NONE, tiers: AB },
  order: { response_mode: 'recognition', n_options: NONE, tiers: A },
  matching: { response_mode: 'recognition', n_options: NONE, tiers: AB },
  code_predict: { response_mode: 'production', n_options: NONE, tiers: AB },
  error_find: { response_mode: 'recognition', n_options: NONE, tiers: A },
  parsons: { response_mode: 'production', n_options: NONE, tiers: A },
  code_task: { response_mode: 'production', n_options: NONE, tiers: ABC },
  sql_task: { response_mode: 'production', n_options: NONE, tiers: ABC },
  infra_lite: { response_mode: 'production', n_options: NONE, tiers: ABC },
  config_review: { response_mode: 'recognition', n_options: NONE, tiers: AB },
  log_read: { response_mode: 'recognition', n_options: { min: 3, max: 5 }, tiers: A },
  cond_reversal: { response_mode: 'recognition', n_options: { min: 2, max: 4 }, tiers: AB },
  fermi: { response_mode: 'production', n_options: NONE, tiers: AB },
  blank_note: { response_mode: 'production', n_options: NONE, tiers: A },
  essay: { response_mode: 'production', n_options: NONE, tiers: AB },
  digging: { response_mode: 'production', n_options: NONE, tiers: AB },
  digging_d4_mcq: { response_mode: 'recognition', n_options: { min: 3, max: 5 }, tiers: A },
  feynman: { response_mode: 'production', n_options: NONE, tiers: A },
  audit: { response_mode: 'recognition', n_options: NONE, tiers: AB },
  pr_review: { response_mode: 'recognition', n_options: NONE, tiers: AB },
  embedded: { response_mode: 'recognition', n_options: { min: 2, max: 4 }, tiers: A },
} as const satisfies Record<(typeof AUTHORING_FORMATS)[number], FormatMeta>;

const authoring: ReadonlySet<string> = new Set<string>(AUTHORING_FORMATS);
const nonAuthoring: ReadonlySet<string> = new Set<string>(NON_AUTHORING_FORMATS);

function assertPartition(): void {
  for (const f of authoring) {
    if (nonAuthoring.has(f)) {
      throw new Error(`invariant: format ${f} is both authoring and non-authoring`);
    }
  }
  const union = new Set<string>([...authoring, ...nonAuthoring]);
  const all = new Set<string>(FormatId.options);
  if (union.size !== all.size || FormatId.options.some((f) => !union.has(f))) {
    throw new Error('invariant: AUTHORING_FORMATS ∪ NON_AUTHORING_FORMATS must equal FormatId.options (33)');
  }
}
assertPartition();

export function isAuthoringFormat(value: unknown): value is (typeof AUTHORING_FORMATS)[number] {
  return typeof value === 'string' && authoring.has(value);
}

export function isNonAuthoringFormat(value: unknown): boolean {
  return typeof value === 'string' && nonAuthoring.has(value);
}
