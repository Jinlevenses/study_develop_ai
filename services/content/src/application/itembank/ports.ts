// itembank BC 읽기 포트 — grading이 `import type`으로 쓴다(catalog 무조회·스냅샷 포함, ARC §6.1). 구현체(어댑터)는 소유 WP가 만든다.
import type { FormatId } from '@fathom/contracts/common/domain';

/** DB-01 `ib_item.source_kind` CHECK 그대로. */
export type ItemSourceKind =
  | 'seed'
  | 't1'
  | 't2'
  | 't3'
  | 't4'
  | 'gap'
  | 'user_error'
  | 'past_self'
  | 'user_authored'
  | 'repo'
  | 'imported';

/** JSON 열은 파싱한 값이다 — 호출자가 zod로 좁힌다. */
export type ItemForGrading = {
  readonly itemId: string;
  readonly contentHash: string;
  readonly format: FormatId;
  readonly responseMode: 'recognition' | 'production';
  readonly level: number;
  readonly stakes: 'S0' | 'S1' | 'S2';
  readonly nOptions: number;
  readonly answerKey: unknown;
  readonly distractorMc: Readonly<Record<string, string>>;
  readonly labId: string | null;
  readonly sourceKind: ItemSourceKind;
  readonly defectManifest: unknown | null;
  readonly snapshot: unknown;
  readonly overlay: Readonly<Record<string, unknown>>;
};
export interface ItemReader {
  getForGrading(itemId: string, contentHash: string): ItemForGrading | null;
}
