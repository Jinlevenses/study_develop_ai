// policy:lock — policy/<name>@v<k>.yaml 정책 팩의 정규화 해시 잠금 파일 policy/policy.lock.json을 만든다·검사한다.
// (PGM-PACKC-010, WP-00-26, ARC-01 §10.4, ADR-004 §9, DCP-01 §6.16, FR-CUR-017) 수기 편집 금지 — lock은 이 스크립트만 쓴다(STD-GIT-05).
// 실행: pnpm policy:lock [--check] [--dir <abs>]. 종료 코드 0 성공 · 1 정책 문제·--check 차이 · 2 엔진 고장(빈 입력·없는 디렉터리·알 수 없는 인자·예외).
// 시계·난수·환경변수 0 → 같은 입력 = 같은 바이트(멱등).
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { AiPolicyV1 } from '@fathom/contracts/policy/ai_policy';
import { CbmParamsV1 } from '@fathom/contracts/policy/cbm_params';
import { ComposerPolicyV1 } from '@fathom/contracts/policy/composer_policy';
import { FirewallRulesV1 } from '@fathom/contracts/policy/firewall_rules';
import { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import { GamingParamsV1 } from '@fathom/contracts/policy/gaming_params';
import { GateThresholdsV1 } from '@fathom/contracts/policy/gate_thresholds';
import { LdiParamsV1 } from '@fathom/contracts/policy/ldi_params';
import { PolicyLock } from '@fathom/contracts/policy/lock';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import { OpsPolicyV1 } from '@fathom/contracts/policy/ops_policy';
import { SearchParamsV1 } from '@fathom/contracts/policy/search_params';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { parseYamlStrict, policyContentHash } from '@fathom/shared-kernel/policy/policy';
import type { z } from 'zod';

type ServiceNameT = ServiceName;
type PolicyLockT = PolicyLock;

/** IF-01 §13.4 정책 표의 소유 열 — 12종 정확히. */
export const POLICY_OWNERS = {
  method_policy: 'learning',
  composer_policy: 'learning',
  mastery_rules: 'learning',
  ldi_params: 'learning',
  gaming_params: 'learning',
  cbm_params: 'learning',
  fsrs_params: 'learning',
  gate_thresholds: 'content',
  search_params: 'content',
  ai_policy: 'ai-gateway',
  firewall_rules: 'ai-gateway',
  ops_policy: 'ops-api',
} as const satisfies Record<string, ServiceNameT>;

export type PolicyName = keyof typeof POLICY_OWNERS;

/** `@v1` 스키마 표(정적 import 12개 — 동적 import 금지, STD 핵심 12). */
export const POLICY_SCHEMAS: { readonly [K in PolicyName]: z.ZodType } = {
  method_policy: MethodPolicyV1,
  composer_policy: ComposerPolicyV1,
  mastery_rules: MasteryRulesV1,
  ldi_params: LdiParamsV1,
  gaming_params: GamingParamsV1,
  cbm_params: CbmParamsV1,
  fsrs_params: FsrsParamsV1,
  gate_thresholds: GateThresholdsV1,
  search_params: SearchParamsV1,
  ai_policy: AiPolicyV1,
  firewall_rules: FirewallRulesV1,
  ops_policy: OpsPolicyV1,
};

export type LockProblem = {
  readonly file: string;
  readonly reason: 'bad_filename' | 'unknown_policy' | 'yaml_error' | 'version_mismatch' | 'schema_invalid';
  readonly detail: string;
};

export const LOCK_FILE = 'policy.lock.json';
const FILE_RE = /^([a-z][a-z0-9_]{2,40})@v(\d{1,4})\.yaml$/;
const DEFAULT_POLICY_DIR = fileURLToPath(new URL('../../../../policy/', import.meta.url));

function isPolicyName(name: string): name is PolicyName {
  return Object.hasOwn(POLICY_OWNERS, name);
}

/** 코드 단위 사전순(로캘 무관). */
function byCode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** `<dir>`의 `*.yaml` 일반 파일 이름(하위 디렉터리 0), 사전순. */
export function listPolicyFiles(policyDir: string): string[] {
  return readdirSync(policyDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.yaml'))
    .map((d) => d.name)
    .sort(byCode);
}

function topLevelVersion(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const v: unknown = Reflect.get(value, 'version');
  return typeof v === 'string' ? v : null;
}

function checkFile(policyDir: string, file: string): Result<{ ref: string; sha256: string; owner: ServiceNameT }, LockProblem> {
  const m = FILE_RE.exec(file);
  const name = m?.[1];
  const k = m?.[2];
  if (name === undefined || k === undefined) {
    return err({ file, reason: 'bad_filename', detail: 'expected <name>@v<k>.yaml (name ^[a-z][a-z0-9_]{2,40}$)' });
  }
  if (!isPolicyName(name)) {
    return err({ file, reason: 'unknown_policy', detail: `${name} is not one of the 12 policies` });
  }
  const version = Number.parseInt(k, 10);
  const ref = `${name}@v${version}`;
  const parsed = parseYamlStrict(readFileSync(join(policyDir, file), 'utf8'));
  if (!parsed.ok) {
    return err({ file, reason: 'yaml_error', detail: parsed.error.detail });
  }
  const declared = topLevelVersion(parsed.value);
  if (declared !== ref) {
    return err({ file, reason: 'version_mismatch', detail: `version ${declared ?? '(missing)'} != ${ref}` });
  }
  // @v2+는 해당 버전 스키마 파일이 생길 때까지 스키마 검사를 생략한다(해시만 잠금).
  if (version === 1) {
    const checked = POLICY_SCHEMAS[name].safeParse(parsed.value);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const where = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
      return err({ file, reason: 'schema_invalid', detail: `${where} ${issue?.message ?? 'schema mismatch'}` });
    }
  }
  return ok({ ref, sha256: policyContentHash(parsed.value), owner: POLICY_OWNERS[name] });
}

/** 정책 디렉터리 → lock 객체. 문제가 하나라도 있으면 전부(파일 이름 순)를 돌려준다. */
export function computeLock(policyDir: string): Result<PolicyLockT, readonly LockProblem[]> {
  const problems: LockProblem[] = [];
  const entries: Record<string, { sha256: string; owner: ServiceNameT }> = {};
  for (const file of listPolicyFiles(policyDir)) {
    const r = checkFile(policyDir, file);
    if (r.ok) {
      entries[r.value.ref] = { sha256: r.value.sha256, owner: r.value.owner };
    } else {
      problems.push(r.error);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(PolicyLock.parse(entries));
}

/** 키 정렬(최상위 ref 사전순, 항목 owner → sha256) + 2칸 들여쓰기 + 끝 줄바꿈 1개. */
export function serializeLock(lock: PolicyLockT): string {
  const checked = PolicyLock.parse(lock);
  const sorted: Record<string, { owner: ServiceNameT; sha256: string }> = {};
  for (const ref of Object.keys(checked).sort(byCode)) {
    const entry = checked[ref];
    if (entry !== undefined) {
      sorted[ref] = { owner: entry.owner, sha256: entry.sha256 };
    }
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function entriesOf(text: string): Map<string, string> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const out = new Map<string, string>();
  for (const key of Object.keys(value)) {
    const entry: unknown = Reflect.get(value, key);
    out.set(key, JSON.stringify(entry));
  }
  return out;
}

/** 기대 lock 텍스트와 실제 파일 텍스트의 차이(줄 단위). 차이 0 = []. */
export function diffLock(expected: string, actualText: string | null): readonly string[] {
  if (actualText === null) {
    return [`missing ${LOCK_FILE}`];
  }
  if (actualText === expected) {
    return [];
  }
  const want = entriesOf(expected);
  const have = entriesOf(actualText);
  if (want === null) {
    throw new Error('invariant: diffLock expected text must be a JSON object');
  }
  if (have === null) {
    return [`invalid ${LOCK_FILE}`];
  }
  const lines: string[] = [];
  for (const [ref, entry] of want) {
    const got = have.get(ref);
    if (got === undefined) {
      lines.push(`missing ${ref}`);
    } else if (canonicalEntry(got) !== canonicalEntry(entry)) {
      lines.push(`stale ${ref}`);
    }
  }
  for (const ref of [...have.keys()].sort(byCode)) {
    if (!want.has(ref)) {
      lines.push(`extra ${ref}`);
    }
  }
  if (lines.length === 0) {
    lines.push(`stale ${LOCK_FILE} (format)`);
  }
  return lines;
}

function canonicalEntry(json: string): string {
  const v: unknown = JSON.parse(json);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return json;
  }
  return JSON.stringify({ owner: Reflect.get(v, 'owner'), sha256: Reflect.get(v, 'sha256') });
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** 종료 코드: 0 성공 · 1 정책 문제·--check 차이 · 2 엔진 고장. */
export function main(argv: readonly string[]): number {
  let check = false;
  let dirArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--check') {
      check = true;
    } else if (a === '--dir' && next !== undefined) {
      dirArg = next;
      i++;
    } else {
      fail(`policy:lock: unknown argument ${a ?? ''}`);
      return 2;
    }
  }
  const policyDir = resolve(dirArg ?? DEFAULT_POLICY_DIR);
  try {
    if (!existsSync(policyDir) || !statSync(policyDir).isDirectory()) {
      fail(`policy:lock: policy directory not found: ${policyDir}`);
      return 2;
    }
    const files = listPolicyFiles(policyDir);
    if (files.length === 0) {
      fail(`policy:lock: no *.yaml policy files in ${policyDir}`);
      return 2;
    }
    const lock = computeLock(policyDir);
    if (!lock.ok) {
      for (const p of lock.error) {
        out(`error ${p.file} ${p.reason} ${p.detail}`);
      }
      return 1;
    }
    const text = serializeLock(lock.value);
    const n = Object.keys(lock.value).length;
    const lockPath = join(policyDir, LOCK_FILE);
    if (check) {
      const lines = diffLock(text, readIfExists(lockPath));
      if (lines.length > 0) {
        for (const l of lines) {
          out(l);
        }
        return 1;
      }
      out(`policy:lock files=${n} ok`);
      return 0;
    }
    const tmp = `${lockPath}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, lockPath);
    out(`policy:lock files=${n} written`);
    return 0;
  } catch (e) {
    fail(`policy:lock: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
