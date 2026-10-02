import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicySetId } from '@fathom/contracts/common/ids';
import { PolicySwitchedV1 } from '@fathom/contracts/ledger/payloads/policy-switched';
import { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import { PolicySetFile } from '@fathom/contracts/policy/lock';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { canonicalJson, parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { loadPolicy } from '@fathom/shared-kernel/policy/policy';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { z } from 'zod';
import type { ProjectorParamsResolver } from '../../application/learner-model/ports.js';
import { buildProjectorParams } from '../../domain/learner-model/fsrs/core.js';
import { ProjectionParamsError } from '../../domain/learner-model/projector/errors.js';
import type { ProjectorParams } from '../../domain/learner-model/projector/types.js';
import { POLICY_SWITCHED_BY_PS } from '../db/learner-model-projection.sql.js';

// ADR-011 §5 · Brief T-01-06 §4.7 — policy_version('ps_<16hex>') → 불변 파라미터 세트. 현재 설정은 읽지 않는다(이벤트 값만, NFR-DATA-002).
// 캐시 미스 시 ① 등록된 members ② lr_event의 policy.switched payload ③ setsDir/<ps>.json 순으로 members를 찾고,
// fsrs_params·mastery_rules를 loadPolicy(lock 해시 대조)로 읽은 뒤 member sha256 = 로드 결과 sha256임을 확인한다.

export type PolicyMembers = Readonly<Record<string, { readonly version: string; readonly sha256: string }>>;

const REF_RE = /^([a-z][a-z0-9_]{2,40})@v(\d{1,4})$/;
const PS_RE = PolicySetId;

function parseRef(ps: string, member: string, ref: string): { readonly name: string; readonly version: number } {
  const m = REF_RE.exec(ref);
  if (m?.[1] === undefined || m[2] === undefined) {
    throw new ProjectionParamsError('params_unresolvable', ps, `member ${member} has an invalid ref ${ref}`);
  }
  return { name: m[1], version: Number(m[2]) };
}

function membersEqual(a: PolicyMembers, b: PolicyMembers): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function createProjectorParamsResolver(opts: {
  readonly policyDir: string;
  readonly setsDir: string | null;
}): ProjectorParamsResolver {
  const registered = new Map<string, PolicyMembers>();
  const cache = new Map<string, ProjectorParams>();

  function membersFromLedger(db: SqlitePort, ps: string): PolicyMembers | null {
    for (const row of db.prepare(POLICY_SWITCHED_BY_PS).iterate({ ps })) {
      const text = row.payload;
      if (typeof text !== 'string') {
        continue;
      }
      const parsed = PolicySwitchedV1.safeParse(parseJsonStrict(text));
      if (parsed.success && parsed.data.policy_version === ps) {
        return parsed.data.members;
      }
    }
    return null;
  }

  function membersFromSetsFile(ps: string): PolicyMembers | null {
    if (opts.setsDir === null || !PS_RE.safeParse(ps).success) {
      return null;
    }
    const file = path.join(opts.setsDir, `${ps}.json`);
    if (!existsSync(file)) {
      return null;
    }
    const parsed = PolicySetFile.safeParse(parseJsonStrict(readFileSync(file, 'utf8')));
    if (!parsed.success || parsed.data.policy_version !== ps) {
      throw new ProjectionParamsError('params_unresolvable', ps, `policy set file ${ps}.json is invalid`);
    }
    return parsed.data.members;
  }

  function loadMember<S extends z.ZodType>(
    ps: string,
    members: PolicyMembers,
    member: 'fsrs_params' | 'mastery_rules',
    schema: S,
  ): z.output<S> {
    const entry = Object.hasOwn(members, member) ? members[member] : undefined;
    if (entry === undefined) {
      throw new ProjectionParamsError('params_unresolvable', ps, `policy set has no ${member} member`);
    }
    const { name, version } = parseRef(ps, member, entry.version);
    const loaded = loadPolicy(name, version, { policyDir: opts.policyDir, schema });
    if (!loaded.ok) {
      throw new ProjectionParamsError('params_unresolvable', ps, `${loaded.error.reason}: ${loaded.error.ref}`);
    }
    if (loaded.value.sha256 !== entry.sha256) {
      throw new ProjectionParamsError(
        'params_hash_mismatch',
        ps,
        `${member} sha256 ${loaded.value.sha256} != set member ${entry.sha256}`,
      );
    }
    return loaded.value.value;
  }

  function build(db: SqlitePort, ps: string): ProjectorParams {
    const members = registered.get(ps) ?? membersFromLedger(db, ps) ?? membersFromSetsFile(ps);
    if (members === null) {
      throw new ProjectionParamsError(
        'params_unresolvable',
        ps,
        'policy set is not registered, in the ledger or in sets',
      );
    }
    const fsrs = loadMember(ps, members, 'fsrs_params', FsrsParamsV1);
    const mastery = loadMember(ps, members, 'mastery_rules', MasteryRulesV1);
    return buildProjectorParams(ps, fsrs, mastery);
  }

  return {
    resolve(db: SqlitePort, policyVersion: string): ProjectorParams {
      const hit = cache.get(policyVersion);
      if (hit !== undefined) {
        return hit;
      }
      const built = build(db, policyVersion);
      cache.set(policyVersion, built);
      return built;
    },
    register(policyVersion: string, members: PolicyMembers): void {
      const prev = registered.get(policyVersion);
      if (prev !== undefined) {
        if (!membersEqual(prev, members)) {
          throw new Error(`invariant: policy set ${policyVersion} re-registered with different members`);
        }
        return;
      }
      registered.set(policyVersion, members);
    },
  };
}
