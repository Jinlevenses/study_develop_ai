import { compareSemver } from './semver.js';

// PGM-CT-001 설치 판정(순수) — Brief T-01-07 §4.4-4. 입력은 행 요약뿐이고 시계·I/O는 없다.

export type PackRowState = 'loading' | 'ready' | 'active' | 'retired' | 'failed';
export type PackRowSummary = {
  readonly install_id: string;
  readonly version: string;
  readonly manifest_hash: string;
  readonly state: PackRowState;
};
export type InstallCandidate = {
  readonly pack_id: string;
  readonly version: string;
  readonly manifest_hash: string;
};
export type DecisionFault = 'in_progress' | 'downgrade' | 'version_conflict';
export type InstallDecision =
  | { readonly action: 'noop'; readonly install_id: string }
  | { readonly action: 'reactivate'; readonly install_id: string }
  | { readonly action: 'load' }
  | { readonly action: 'reject'; readonly fault: DecisionFault; readonly detail: string };

/**
 * 후보 1개 × 그 팩의 설치 행들 → 판정.
 *  1. loading·ready 행이 있으면 in_progress(슬롯 점유).
 *  2. 같은 버전 행(failed 제외 — 부분 유니크 인덱스와 같은 규칙):
 *     active·같은 hash → noop · active|retired·다른 hash → version_conflict · retired·같은 hash → reactivate.
 *  3. 활성 버전 > 후보 ∧ !allow_downgrade → downgrade.
 *  4. 그 밖 → load.
 * reactivate가 활성 버전보다 낮은 retired 설치를 되살리는 것이면 그것도 하향이므로 3의 검사를 먼저 적용한다 [Brief 결정 — 되돌림은 allow_downgrade 필요].
 */
export function decideInstall(
  candidate: InstallCandidate,
  rowsOfPack: readonly PackRowSummary[],
  allowDowngrade: boolean,
): InstallDecision {
  if (rowsOfPack.some((r) => r.state === 'loading' || r.state === 'ready')) {
    return { action: 'reject', fault: 'in_progress', detail: `pack ${candidate.pack_id} install in progress` };
  }
  const active = rowsOfPack.find((r) => r.state === 'active') ?? null;
  const same = rowsOfPack.find((r) => r.state !== 'failed' && r.version === candidate.version) ?? null;
  if (same !== null && same.manifest_hash !== candidate.manifest_hash) {
    return {
      action: 'reject',
      fault: 'version_conflict',
      detail: `pack ${candidate.pack_id}@${candidate.version} already installed with a different manifest`,
    };
  }
  if (same !== null && same.state === 'active') {
    return { action: 'noop', install_id: same.install_id };
  }
  if (active !== null && compareSemver(active.version, candidate.version) > 0 && !allowDowngrade) {
    return {
      action: 'reject',
      fault: 'downgrade',
      detail: `pack ${candidate.pack_id}@${candidate.version} is older than active ${active.version}`,
    };
  }
  if (same !== null && same.state === 'retired') {
    return { action: 'reactivate', install_id: same.install_id };
  }
  return { action: 'load' };
}
