import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import { GamingParamsV1 } from '@fathom/contracts/policy/gaming_params';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { loadPolicy, policySetId } from '@fathom/shared-kernel/policy/policy';
import { buildProjectorParams } from '../../../../src/domain/learner-model/fsrs/core.js';
import type { ProjectorParams } from '../../../../src/domain/learner-model/projector/types.js';

// 저장소 policy/ 디렉터리의 실제 정책 값(lock 해시 대조 포함)으로 만든 테스트용 파라미터 세트.

export const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
export const POLICY_DIR = path.join(REPO_ROOT, 'policy');

function must<T>(r: { ok: true; value: T } | { ok: false; error: { reason: string; ref: string } }): T {
  if (!r.ok) {
    throw new Error(`policy load failed: ${r.error.ref}: ${r.error.reason}`);
  }
  return r.value;
}

export const FSRS_POLICY = must(loadPolicy('fsrs_params', 1, { policyDir: POLICY_DIR, schema: FsrsParamsV1 }));
export const MASTERY_POLICY = must(loadPolicy('mastery_rules', 1, { policyDir: POLICY_DIR, schema: MasteryRulesV1 }));
export const GAMING_POLICY = must(loadPolicy('gaming_params', 1, { policyDir: POLICY_DIR, schema: GamingParamsV1 }));

export const FSRS: FsrsParamsV1 = FSRS_POLICY.value;
export const MASTERY: MasteryRulesV1 = MASTERY_POLICY.value;
export const GAMING: GamingParamsV1 = GAMING_POLICY.value;

export const REPO_MEMBERS = {
  fsrs_params: { version: 'fsrs_params@v1', sha256: FSRS_POLICY.sha256 },
  mastery_rules: { version: 'mastery_rules@v1', sha256: MASTERY_POLICY.sha256 },
} as const;
export const REPO_PS: string = policySetId(REPO_MEMBERS, null);

/** 변형 파라미터 세트 — 변형마다 다른 ps 주소(내용 해시)를 갖는다. */
export function makeParams(
  opts: {
    readonly mastery?: (m: MasteryRulesV1) => MasteryRulesV1;
    readonly fsrs?: (f: FsrsParamsV1) => FsrsParamsV1;
    readonly ps?: string;
  } = {},
): ProjectorParams {
  const mastery = opts.mastery === undefined ? MASTERY : opts.mastery(MASTERY);
  const fsrs = opts.fsrs === undefined ? FSRS : opts.fsrs(FSRS);
  if (opts.mastery === undefined && opts.fsrs === undefined && opts.ps === undefined) {
    return buildProjectorParams(REPO_PS, fsrs, mastery);
  }
  const ps = opts.ps ?? `ps_${sha256Hex(JSON.stringify({ mastery, fsrs })).slice(0, 16)}`;
  return buildProjectorParams(ps, fsrs, mastery);
}

export const REPO_PARAMS: ProjectorParams = makeParams();
