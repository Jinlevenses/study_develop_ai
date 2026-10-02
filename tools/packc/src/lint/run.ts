// check 파이프라인: discover → load → V1 → ContentModel → V2(10규칙) → V7 바인딩(error 0일 때만).
// 엔진 고장(content·packs 없음, 팩 디렉터리 0개, 스캔 0파일, 정책 로드 실패, 없는 --pack)은 err(reason) → CLI가 exit 2.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { prepare } from '../emit/build.js';
import { discover } from '../parse/discover.js';
import { loadFile } from '../parse/load.js';
import type { Finding } from '../validate/finding.js';
import { byCode, finding, sortFindings } from '../validate/finding.js';
import type { LintContext, LoadedFile } from '../validate/model.js';
import { buildIndexes, buildModel } from '../validate/model.js';
import { loadPolicies } from '../validate/policy.js';
import { validateV1 } from '../validate/v1-schema.js';
import { ruleThreeStage } from './rules/r-3stage.js';
import { ruleAlias } from './rules/r-alias.js';
import { ruleDag } from './rules/r-dag.js';
import { ruleFmt } from './rules/r-fmt.js';
import { ruleId } from './rules/r-id.js';
import { ruleLvl } from './rules/r-lvl.js';
import { rulePool } from './rules/r-pool.js';
import { ruleRef } from './rules/r-ref.js';
import { ruleReq } from './rules/r-req.js';
import { ruleSrc } from './rules/r-src.js';

export type Stage = 'V1' | 'V2' | 'V7';

export type CheckOptions = {
  readonly contentDir: string;
  readonly policyDir: string;
  /** null = 전체 팩. */
  readonly packs: readonly string[] | null;
  /** null = V1·V2·V7 전부. V1은 항상 실행·보고한다. */
  readonly only: ReadonlySet<Stage> | null;
  readonly release: boolean;
};

export type CheckResult = {
  /** 선택 팩(+공용 파일)으로 한정하고 정렬한 finding. */
  readonly findings: readonly Finding[];
  /** 선택된 팩 id(정렬). */
  readonly packs: readonly string[];
  /** 선택 범위의 스캔 파일 수. */
  readonly files: number;
  /** 전체 트리 모델(교차 팩 참조 해석용) — emit이 이어서 쓴다. */
  readonly ctx: LintContext;
  /** 선택 범위의 V1·V2 error가 0인가(V7 단계·emit 전제). */
  readonly clean: boolean;
};

export const RULES: readonly (readonly [string, (ctx: LintContext) => Finding[]])[] = [
  ['R-ID', ruleId],
  ['R-DAG', ruleDag],
  ['R-LVL', ruleLvl],
  ['R-REF', ruleRef],
  ['R-SRC', ruleSrc],
  ['R-3STAGE', ruleThreeStage],
  ['R-REQ', ruleReq],
  ['R-ALIAS', ruleAlias],
  ['R-POOL', rulePool],
  ['R-FMT', ruleFmt],
];

/** 경로가 속한 팩(packs/<t>/…, review/V7/<p>/…) 또는 null(공용: templates·sources·policy …). */
export function packOfPath(rel: string): string | null {
  const seg = rel.split('/');
  if (seg[0] === 'packs' && seg.length >= 3) {
    return seg[1] ?? null;
  }
  if (seg[0] === 'review' && seg[1] === 'V7' && seg.length >= 4) {
    return seg[2] ?? null;
  }
  return null;
}

function dirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(byCode);
}

export function runCheck(opts: CheckOptions): Result<CheckResult, string> {
  const { contentDir, policyDir } = opts;
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    return err(`content directory not found: ${contentDir}`);
  }
  const packsDir = join(contentDir, 'packs');
  if (!existsSync(packsDir) || !statSync(packsDir).isDirectory()) {
    return err(`packs directory not found: ${packsDir}`);
  }
  const packDirs = dirNames(packsDir);
  if (packDirs.length === 0) {
    return err(`no pack directories under ${packsDir}`);
  }
  for (const p of opts.packs ?? []) {
    if (!packDirs.includes(p)) {
      return err(`unknown pack: ${p}`);
    }
  }
  const policies = loadPolicies(policyDir);
  if (!policies.ok) {
    return err(policies.error);
  }
  const discovered = discover(contentDir);
  if (discovered.length === 0) {
    return err(`no content files scanned in ${contentDir}`);
  }

  const v1: Finding[] = [];
  const loaded: LoadedFile[] = [];
  for (const d of discovered) {
    if (d.type === 'problem') {
      v1.push(finding('V1', 'error', d.rel, '', d.message));
      continue;
    }
    const r = loadFile(contentDir, d);
    v1.push(...r.findings);
    if (r.raw === null) {
      continue;
    }
    const checked = validateV1(r.raw, { policyDir });
    v1.push(...checked.findings);
    if (checked.file !== null) {
      loaded.push(checked.file);
    }
  }
  const hasPackYaml = new Set(loaded.filter((f) => f.kind === 'pack').map((f) => f.disc.track));
  for (const p of packDirs) {
    if (!p.startsWith('x.') && !hasPackYaml.has(p) && !v1.some((f) => f.file === `packs/${p}/pack.yaml`)) {
      v1.push(finding('V1', 'error', `packs/${p}/pack.yaml`, '', 'pack.yaml is missing'));
    }
  }

  const model = buildModel(loaded);
  const ctx: LintContext = {
    model,
    idx: buildIndexes(model),
    mastery: policies.value.mastery,
    method: policies.value.method,
    release: opts.release,
  };
  const v2: Finding[] = [];
  for (const [, rule] of RULES) {
    v2.push(...rule(ctx));
  }

  const selected = opts.packs === null ? packDirs : [...new Set(opts.packs)].sort(byCode);
  const inScope = (f: Finding): boolean => {
    const p = packOfPath(f.file);
    return p === null || selected.includes(p);
  };
  const clean = ![...v1, ...v2].filter(inScope).some((f) => f.severity === 'error');
  const v7: Finding[] = [];
  if (clean) {
    for (const p of model.packs.map((x) => x.data.id).sort(byCode)) {
      if (selected.includes(p)) {
        const prepared = prepare(ctx, p);
        v7.push(...prepared.records.findings, ...prepared.binding.findings);
      }
    }
  }

  const want = (s: Stage): boolean => opts.only === null || opts.only.has(s);
  const findings = sortFindings([...v1, ...(want('V2') ? v2 : []), ...(want('V7') ? v7 : [])].filter(inScope));
  const files = discovered.filter((d) => {
    const p = packOfPath(d.rel);
    return p === null || selected.includes(p);
  }).length;
  return ok({ findings, packs: selected, files, ctx, clean });
}
