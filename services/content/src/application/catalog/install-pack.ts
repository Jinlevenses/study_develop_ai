import path from 'node:path';
import type { InstallPackRequest, PackInstallView } from '@fathom/contracts/http/content/v1/catalog';
import type { AppError, Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Outbox } from '@fathom/shared-kernel/eventing/eventing';
import type { JobFailure, JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { InstallDecision, PackRowSummary } from '../../domain/catalog/install/decide.js';
import { decideInstall } from '../../domain/catalog/install/decide.js';
import type { PlanPack, RequestFailure, RequestMemory, ViewRow } from '../../domain/catalog/install/view.js';
import { buildInstallView } from '../../domain/catalog/install/view.js';
import {
  SELECT_ACTIVE_CONCEPT_IDS_OF_PACK,
  SELECT_PACK_ROWS_OF_PACK,
  SELECT_REQUEST_ROWS,
} from '../../infra/db/ct-catalog-read.sql.js';
import { listBundledPacks, selectBundledPacks } from '../../infra/packs/bundled-packs.js';
import type { VerifiedFpack } from '../../infra/packs/fpack-reader.js';
import { readFpack } from '../../infra/packs/fpack-reader.js';
import { activateInstall } from './ingest/activate.js';
import { failUnfinishedInstalls, insertInstallRows, markInstallFailed } from './ingest/install-rows.js';
import { sanitizeFailureCode } from './ingest/pack-load-run.js';
import type { IngestRegistry } from './ports.js';
import { catalogFault } from './errors.js';
import type { Row } from './row-read.js';
import { int, intOrNull, str, strOrNull } from './row-read.js';

// PGM-CT-001 PackInstaller — Brief T-01-07 §4.4. IF-CT-001(202 본문 = 동기 부분)·IF-CT-002(진행 조회).
// 동기 부분: 원천 해석 → 슬롯 확인 → 전부 검증 → 판정 → 설치 행 생성(1 tx). 백그라운드: 팩 순서대로 job `pack-load` → 활성화 1 tx.

const DEFAULT_LOAD_TIMEOUT_MS = 120_000;
const RECENT_REQUESTS = 64;

export type PackInstallerDeps = {
  readonly db: SqlitePort;
  readonly outbox: Outbox;
  readonly jobs: JobRunner;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly log: Logger;
  readonly home: string;
  /** 'bundled' 원천 디렉터리(결선 T-01-11이 정한다). */
  readonly packsDir: string;
  /** activate 훅 호출용. */
  readonly ingest: IngestRegistry;
  /** 기본 120_000. */
  readonly loadTimeoutMs?: number;
};

export interface PackInstaller {
  /** 동기 부분만 — 202 본문. */
  install(req: InstallPackRequest): Result<PackInstallView, AppError>;
  /** IF-CT-002 (null → CT-NOTFOUND-003). */
  get(installId: string): PackInstallView | null;
  /** 기동 시 1회: loading·ready → failed('interrupted'). 바뀐 행 수. */
  recoverInterrupted(): number;
  /** 백그라운드 완료 대기(onShutdown·테스트). */
  idle(): Promise<void>;
}

type Plan = {
  readonly action: 'load' | 'reactivate';
  readonly install_id: string;
  readonly file: string;
  readonly fpack: VerifiedFpack;
};
type MutableMemory = {
  packs: readonly PlanPack[];
  phase: RequestMemory['phase'];
  started_at: number;
  finished_at: number | null;
  failure: RequestFailure | null;
};

const VIEW_STATES: ReadonlySet<string> = new Set(['loading', 'ready', 'active', 'retired', 'failed']);

function toViewRow(row: Row): ViewRow {
  const state = str(row, 'state');
  if (!VIEW_STATES.has(state)) {
    throw new Error('invariant: ct_pack.state out of range');
  }
  return {
    pack_id: str(row, 'pack_id'),
    track_id: strOrNull(row, 'track_id'),
    version: str(row, 'version'),
    state: state as ViewRow['state'],
    state_reason: strOrNull(row, 'state_reason'),
    created_at: int(row, 'created_at'),
    activated_at: intOrNull(row, 'activated_at'),
    previous_version: strOrNull(row, 'previous_version'),
    error_id: strOrNull(row, 'error_id'),
    finished_at: intOrNull(row, 'finished_at'),
  };
}

function toRowSummary(row: Row): PackRowSummary {
  const state = str(row, 'state');
  if (!VIEW_STATES.has(state)) {
    throw new Error('invariant: ct_pack.state out of range');
  }
  return {
    install_id: str(row, 'install_id'),
    version: str(row, 'version'),
    manifest_hash: str(row, 'manifest_hash'),
    state: state as PackRowSummary['state'],
  };
}

function failureReason(f: JobFailure): string {
  return f.kind === 'job_error' ? `pack_load:${sanitizeFailureCode(f.message)}` : `pack_load:${f.kind}`;
}

export function createPackInstaller(deps: PackInstallerDeps): PackInstaller {
  const { db } = deps;
  const timeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const requests = new Map<string, MutableMemory>();
  let inflight: Promise<void> | null = null;

  function remember(requestId: string, memory: MutableMemory): void {
    requests.delete(requestId);
    requests.set(requestId, memory);
    while (requests.size > RECENT_REQUESTS) {
      const oldest = requests.keys().next();
      if (oldest.done === true) {
        break;
      }
      requests.delete(oldest.value);
    }
  }

  function viewOf(requestId: string): PackInstallView | null {
    const memory = requests.get(requestId) ?? null;
    const rows = db.prepare(SELECT_REQUEST_ROWS).all({ request_id: requestId }).map(toViewRow);
    if (memory === null && rows.length === 0) {
      return null;
    }
    return buildInstallView(requestId, rows, memory, deps.clock.now());
  }

  /** 1. 원천 해석 — bundled 목록(semver 최댓값·track 필터)·file 절대 경로·user_dir 미지원. */
  function resolveSource(source: InstallPackRequest['source']): Result<readonly string[], AppError> {
    switch (source.kind) {
      case 'bundled': {
        const picked = selectBundledPacks(listBundledPacks(deps.packsDir), source.track);
        if (picked.length === 0) {
          return err(catalogFault('install_not_found', 'no bundled pack matches'));
        }
        return ok(picked.map((p) => p.file));
      }
      case 'file':
        return path.isAbsolute(source.path)
          ? ok([source.path])
          : err(catalogFault('validation', 'file_path_not_absolute'));
      case 'user_dir':
        return err(catalogFault('validation', 'user_dir unsupported in R0')); // [Brief 결정 — R3]
    }
  }

  function failPlans(
    requestId: string,
    memory: MutableMemory,
    failing: Plan,
    remaining: readonly Plan[],
    reason: string,
  ): void {
    const now = deps.clock.now();
    const errorId = deps.newId();
    if (failing.action === 'load') {
      markInstallFailed(db, failing.install_id, reason, errorId, now);
    }
    for (const rest of remaining) {
      if (rest.action === 'load') {
        markInstallFailed(db, rest.install_id, 'aborted', deps.newId(), now);
      }
    }
    memory.failure = { detail: reason, error_id: errorId, finished_at: now };
    deps.log.warn({ install_id: requestId, reason }, 'catalog.pack.install.failed');
  }

  /** 3. 검증(전부 먼저, 쓰기 0) + 4. 판정. 하나라도 거부면 요청 전체 오류. */
  function plan(
    req: InstallPackRequest,
    files: readonly string[],
  ): Result<{ plans: Plan[]; packs: PlanPack[] }, AppError> {
    const verified: { file: string; fpack: VerifiedFpack }[] = [];
    for (const file of files) {
      const read = readFpack(file);
      if (!read.ok) {
        return err(catalogFault('validation', read.error.reason));
      }
      if (read.value.manifest.channel !== req.channel) {
        return err(catalogFault('validation', 'channel_mismatch'));
      }
      verified.push({ file, fpack: read.value });
    }
    for (const { fpack } of verified) {
      const active = db.prepare(SELECT_ACTIVE_CONCEPT_IDS_OF_PACK).all({ pack_id: fpack.manifest.pack_id });
      for (const row of active) {
        const id = str(row, 'concept_id');
        if (!fpack.concept_ids.has(id)) {
          return err(catalogFault('validation', `concept_removed:${id}`)); // 안정 ID — 폐기는 deprecated_by로만(FR-CUR-004)
        }
      }
    }
    const plans: Plan[] = [];
    const packs: PlanPack[] = [];
    for (const { file, fpack } of verified) {
      const m = fpack.manifest;
      const rows = db.prepare(SELECT_PACK_ROWS_OF_PACK).all({ pack_id: m.pack_id }).map(toRowSummary);
      const decision: InstallDecision = decideInstall(
        { pack_id: m.pack_id, version: m.version, manifest_hash: fpack.manifest_hash },
        rows,
        req.allow_downgrade,
      );
      if (decision.action === 'reject') {
        return err(catalogFault(decision.fault, decision.detail));
      }
      const previous = rows.find((r) => r.state === 'active')?.version ?? null;
      packs.push({
        pack_id: m.pack_id,
        track: m.track,
        version: m.version,
        previous_version: decision.action === 'noop' ? null : previous,
      });
      if (decision.action === 'load') {
        plans.push({ action: 'load', install_id: deps.newId(), file, fpack });
      } else if (decision.action === 'reactivate') {
        plans.push({ action: 'reactivate', install_id: decision.install_id, file, fpack });
      }
    }
    return ok({ plans, packs });
  }

  /** 6. 백그라운드 — 팩 순서대로. 실패하면 남은 팩은 계속하지 않고 failed('aborted')(요청 단위 순서 보장). 이미 활성화된 팩은 유지. */
  async function runPlans(req: InstallPackRequest, memory: MutableMemory, plans: readonly Plan[]): Promise<void> {
    for (let i = 0; i < plans.length; i += 1) {
      const current = plans[i];
      if (current === undefined) {
        break;
      }
      const remaining = plans.slice(i + 1);
      memory.phase = 'loading';
      if (current.action === 'load') {
        const result = await deps.jobs.run(
          'pack-load',
          {
            home: deps.home,
            install_id: current.install_id,
            fpack_path: current.file,
            expected_sha256: current.fpack.source_sha256,
          },
          { timeoutMs },
        );
        if (!result.ok) {
          failPlans(req.install_id, memory, current, remaining, failureReason(result.error));
          return;
        }
      }
      memory.phase = 'activating';
      try {
        activateInstall(
          { outbox: deps.outbox, clock: deps.clock, ingest: deps.ingest },
          current.install_id,
          req.install_id,
        );
      } catch (e) {
        deps.log.error({ install_id: req.install_id, err: e instanceof Error ? e.message : String(e) }, 'catalog.pack.activate.failed');
        failPlans(req.install_id, memory, current, remaining, 'pack_load:activation_failed');
        return;
      }
    }
  }

  return {
    install(req: InstallPackRequest): Result<PackInstallView, AppError> {
      const files = resolveSource(req.source);
      if (!files.ok) {
        return files;
      }
      if (inflight !== null) {
        return err(catalogFault('in_progress', 'another pack install request is running'));
      }
      if (deps.jobs.isBusy()) {
        return err(catalogFault('jobs_busy', 'the job slot is busy'));
      }
      const planned = plan(req, files.value);
      if (!planned.ok) {
        return planned;
      }
      const now = deps.clock.now();
      const memory: MutableMemory = {
        packs: planned.value.packs,
        phase: planned.value.plans.length === 0 ? null : 'loading',
        started_at: now,
        finished_at: planned.value.plans.length === 0 ? now : null,
        failure: null,
      };
      remember(req.install_id, memory);
      const loads = planned.value.plans.filter((p) => p.action === 'load');
      if (loads.length > 0) {
        const previousOf = new Map(planned.value.packs.map((p) => [p.pack_id, p.previous_version] as const));
        insertInstallRows(
          db,
          loads.map((p) => ({
            install_id: p.install_id,
            request_id: req.install_id,
            previous_version: previousOf.get(p.fpack.manifest.pack_id) ?? null,
            channel: req.channel,
            fpack: p.fpack,
          })),
          now,
        );
      }
      if (planned.value.plans.length > 0) {
        const background = runPlans(req, memory, planned.value.plans)
          .catch((e: unknown) => {
            memory.failure = { detail: 'pack_load:internal', error_id: deps.newId(), finished_at: deps.clock.now() };
            deps.log.error({ install_id: req.install_id, err: e instanceof Error ? e.message : String(e) }, 'catalog.pack.install.crashed');
          })
          .finally(() => {
            memory.phase = null;
            memory.finished_at = deps.clock.now();
            inflight = null;
          });
        inflight = background;
      }
      const view = viewOf(req.install_id);
      if (view === null) {
        throw new Error('invariant: install view missing right after the request was recorded');
      }
      return ok(view);
    },

    get(installId: string): PackInstallView | null {
      return viewOf(installId);
    },

    recoverInterrupted(): number {
      return failUnfinishedInstalls(db, deps.newId, deps.clock.now());
    },

    async idle(): Promise<void> {
      while (inflight !== null) {
        await inflight;
      }
    },
  };
}
