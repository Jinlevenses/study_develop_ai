import { COMMON_ERRORS } from '@fathom/contracts/common/errors';
import { PackInstallView } from '@fathom/contracts/http/content/v1/catalog';

// PGM-CT-001 설치 view 재구성(순수) — Brief T-01-07 §4.4-7. 행(DB) + 진행 중 phase(메모리) → `PackInstallView`.

export type InstallPhase = 'verifying' | 'loading' | 'activating';

/** `ct_pack` 한 행에서 view에 필요한 값만(ext 키 `catalog.*`는 읽는 쪽이 풀어 넘긴다). */
export type ViewRow = {
  readonly pack_id: string;
  readonly track_id: string | null;
  readonly version: string;
  readonly state: 'loading' | 'ready' | 'active' | 'retired' | 'failed';
  readonly state_reason: string | null;
  readonly created_at: number;
  readonly activated_at: number | null;
  readonly previous_version: string | null;
  readonly error_id: string | null;
  readonly finished_at: number | null;
};
export type PlanPack = {
  readonly pack_id: string;
  readonly track: string;
  readonly version: string;
  readonly previous_version: string | null;
};
export type RequestFailure = { readonly detail: string; readonly error_id: string; readonly finished_at: number };
/** 이 installer가 기억하는 요청 상태(프로세스 메모리) — 행이 없는 요청(noop·reactivate)과 진행 중 phase를 담는다. */
export type RequestMemory = {
  readonly packs: readonly PlanPack[];
  readonly phase: InstallPhase | null;
  readonly started_at: number;
  readonly finished_at: number | null;
  readonly failure: RequestFailure | null;
};

const INTERNAL_900 = 'CT-INTERNAL-900';

function byPackId(a: { readonly pack_id: string }, b: { readonly pack_id: string }): number {
  if (a.pack_id === b.pack_id) {
    return 0;
  }
  return a.pack_id < b.pack_id ? -1 : 1;
}

function failureOf(rows: readonly ViewRow[], memory: RequestMemory | null): RequestFailure | null {
  const failed = rows.filter((r) => r.state === 'failed');
  const finishedAt = failed.reduce((max, r) => Math.max(max, r.finished_at ?? r.created_at), 0);
  const first = failed[0];
  if (first !== undefined) {
    return {
      detail: first.state_reason ?? 'unknown',
      error_id: first.error_id ?? '00000000000000000000000000',
      finished_at: finishedAt,
    };
  }
  return memory?.failure ?? null;
}

/**
 * 상태 규칙: 진행 중 phase(메모리) 우선 → failed 행(또는 메모리 실패) 하나라도 → `failed` → 전부 active/retired(행 없음 포함) → `activated` → 그 밖 `loading`.
 * `started_at` = 최소 created_at(행 없으면 메모리), `finished_at` = 종료 시 최대값·진행 중 null.
 */
export function buildInstallView(
  requestId: string,
  rowsIn: readonly ViewRow[],
  memory: RequestMemory | null,
  fallbackNow: number,
): PackInstallView {
  const rows = [...rowsIn].sort(byPackId);
  const failure = failureOf(rows, memory);
  let state: PackInstallView['state'];
  if (memory?.phase !== null && memory?.phase !== undefined) {
    state = memory.phase;
  } else if (failure !== null) {
    state = 'failed';
  } else if (rows.every((r) => r.state === 'active' || r.state === 'retired')) {
    state = 'activated';
  } else {
    state = 'loading';
  }
  const packs =
    memory !== null
      ? [...memory.packs].sort(byPackId).map((p) => ({ ...p, conflicts: 0 }))
      : rows.flatMap((r) =>
          r.track_id === null
            ? []
            : [
                {
                  pack_id: r.pack_id,
                  track: r.track_id,
                  version: r.version,
                  previous_version: r.previous_version,
                  conflicts: 0,
                },
              ],
        );
  const rowStarts = rows.map((r) => r.created_at);
  const startedAt = memory?.started_at ?? (rowStarts.length > 0 ? Math.min(...rowStarts) : fallbackNow);
  let finishedAt: number | null = null;
  if (state === 'failed') {
    finishedAt = failure?.finished_at ?? fallbackNow;
  } else if (state === 'activated') {
    const activated = rows.map((r) => r.activated_at ?? r.created_at);
    finishedAt = memory?.finished_at ?? (activated.length > 0 ? Math.max(...activated) : startedAt);
  }
  const problem =
    state === 'failed' && failure !== null
      ? {
          type: 'urn:fathom:problem:ct-internal-900',
          title: COMMON_ERRORS['INTERNAL-900'].title,
          status: 500,
          code: INTERNAL_900,
          detail: failure.detail,
          error_id: failure.error_id,
          request_id: requestId,
          retryable: false,
        }
      : null;
  return PackInstallView.parse({
    install_id: requestId,
    state,
    packs,
    problem,
    started_at: startedAt,
    finished_at: finishedAt === null ? null : Math.max(finishedAt, startedAt),
  });
}
