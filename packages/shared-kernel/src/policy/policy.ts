import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { PolicyLock } from '@fathom/contracts/policy/lock';
import { canonicalJson, parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { parseDocument, visit } from 'yaml';
import type { z } from 'zod';

// ADR-004 §9 · ARC-01 §10.4 · CR-57 — 정책 팩(YAML)은 `policy.lock.json`의 sha256과 일치할 때만 로드한다(FR-CUR-017).

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
// YAML 1.2 core 스키마의 태그만 허용한다. `yaml` 라이브러리는 `!!binary`·`!!set` 같은 명시 태그를 core에서도 해석하므로 직접 거른다.
const CORE_TAGS: ReadonlySet<string> = new Set(
  ['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map((t) => `tag:yaml.org,2002:${t}`),
);
const NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;

type YamlFailure = { reason: 'yaml_error'; detail: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 결과 트리에서 오염 키·비유한 수·비 JSON 값을 찾는다. 문제가 있으면 설명을, 없으면 null. */
function findUnsafeValue(value: unknown, where: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `non-finite number at ${where}`;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const problem = findUnsafeValue(item, `${where}[${i}]`);
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  }
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return `non-plain object at ${where}`;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return `forbidden key ${key} at ${where}`;
      }
      const problem = findUnsafeValue(Reflect.get(value, key), `${where}.${key}`);
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  }
  return `unsupported value at ${where}`;
}

/**
 * STD-SEC-08 — core 스키마·중복 키 거부·merge 키 끔·별칭/앵커 거부·오염 키 거부.
 * `maxAliasCount: 0` 의미를 라이브러리에만 맡기지 않고 문서 트리에서 별칭·앵커를 직접 찾는다. 예외는 `yaml_error`로 옮긴다.
 */
export function parseYamlStrict(text: string): Result<unknown, YamlFailure> {
  try {
    const doc = parseDocument(text, { schema: 'core', uniqueKeys: true, merge: false });
    const firstError = doc.errors[0];
    if (firstError !== undefined) {
      return err({ reason: 'yaml_error', detail: firstError.message });
    }
    const firstWarning = doc.warnings[0];
    if (firstWarning !== undefined) {
      return err({ reason: 'yaml_error', detail: firstWarning.message });
    }
    let unsafeNode: string | null = null;
    visit(doc, {
      Alias() {
        unsafeNode = 'alias';
        return visit.BREAK;
      },
      Node(_key, node) {
        if ('tag' in node && typeof node.tag === 'string' && !CORE_TAGS.has(node.tag)) {
          unsafeNode = `tag ${node.tag}`;
          return visit.BREAK;
        }
        if ('anchor' in node && typeof node.anchor === 'string' && node.anchor !== '') {
          unsafeNode = `anchor &${node.anchor}`;
          return visit.BREAK;
        }
        return undefined;
      },
    });
    if (unsafeNode !== null) {
      return err({ reason: 'yaml_error', detail: `${unsafeNode} is not allowed in policy files` });
    }
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    const unsafe = findUnsafeValue(value, '$');
    if (unsafe !== null) {
      return err({ reason: 'yaml_error', detail: unsafe });
    }
    return ok(value);
  } catch (e) {
    return err({ reason: 'yaml_error', detail: messageOf(e) });
  }
}

/** lock 해시 규약(DCP-01 §6.16): `sha256Hex(canonicalJson(parsed yaml))`. T-00-15 lock-cli가 같은 함수를 import한다. */
export function policyContentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export type LoadedPolicy<T> = {
  readonly ref: string;
  readonly sha256: string;
  readonly owner: ServiceName;
  readonly value: T;
};
export type PolicyLoadFailure = {
  readonly reason:
    | 'lock_missing'
    | 'lock_invalid'
    | 'not_in_lock'
    | 'file_missing'
    | 'yaml_error'
    | 'hash_mismatch'
    | 'schema_invalid';
  readonly exitCode: 78;
  readonly ref: string;
  readonly detail: string;
};

function fail(reason: PolicyLoadFailure['reason'], ref: string, detail: string): Result<never, PolicyLoadFailure> {
  return err({ reason, exitCode: 78, ref, detail });
}

function readTextIfExists(file: string): Result<string | null, string> {
  try {
    return ok(readFileSync(file, 'utf8'));
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT') {
      return ok(null);
    }
    return err(messageOf(e));
  }
}

/**
 * 기동 시 1회(동기 fs 허용). 같은 `name@vN`인데 lock 해시와 다르면 `hash_mismatch`로 기동을 거부한다(exit 78).
 * [Brief 결정] ARC의 `loadPolicy(name, version)`에 `deps.schema`(호출자가 contracts 정책 스키마를 넘김)·`deps.policyDir`를 더했다.
 */
export function loadPolicy<S extends z.ZodType>(
  name: string,
  version: number,
  deps: { readonly policyDir: string; readonly schema: S },
): Result<LoadedPolicy<z.output<S>>, PolicyLoadFailure> {
  if (!NAME_RE.test(name)) {
    throw new Error('invariant: loadPolicy name must match ^[a-z][a-z0-9_]{2,40}$');
  }
  if (!Number.isInteger(version) || version < 1 || version > 9999) {
    throw new Error('invariant: loadPolicy version must be an integer 1..9999');
  }
  const ref = `${name}@v${version}`;

  const lockText = readTextIfExists(path.join(deps.policyDir, 'policy.lock.json'));
  if (!lockText.ok) {
    return fail('lock_invalid', ref, lockText.error);
  }
  if (lockText.value === null) {
    return fail('lock_missing', ref, 'policy.lock.json not found');
  }
  let lockJson: unknown;
  try {
    lockJson = parseJsonStrict(lockText.value);
  } catch (e) {
    return fail('lock_invalid', ref, messageOf(e));
  }
  const lock = PolicyLock.safeParse(lockJson);
  if (!lock.success) {
    return fail('lock_invalid', ref, lock.error.issues[0]?.message ?? 'lock schema mismatch');
  }
  const entry = lock.data[ref];
  if (entry === undefined) {
    return fail('not_in_lock', ref, `${ref} is not listed in policy.lock.json`);
  }

  const yamlText = readTextIfExists(path.join(deps.policyDir, `${ref}.yaml`));
  if (!yamlText.ok) {
    return fail('file_missing', ref, yamlText.error);
  }
  if (yamlText.value === null) {
    return fail('file_missing', ref, `${ref}.yaml not found`);
  }
  const parsed = parseYamlStrict(yamlText.value);
  if (!parsed.ok) {
    return fail('yaml_error', ref, parsed.error.detail);
  }
  const hash = policyContentHash(parsed.value);
  if (hash !== entry.sha256) {
    return fail('hash_mismatch', ref, `content sha256 ${hash} != lock sha256 ${entry.sha256}`);
  }
  const checked = deps.schema.safeParse(parsed.value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
    return fail('schema_invalid', ref, where);
  }
  return ok({ ref, sha256: entry.sha256, owner: entry.owner, value: checked.data });
}

/** 정책 세트 콘텐츠 주소: `'ps_' + sha256(canonicalJson({members, overrides_sha256})).slice(0, 16)`(멤버 순서 무관). */
export function policySetId(
  members: Readonly<Record<string, { version: string; sha256: string }>>,
  overridesSha256: string | null,
): string {
  return `ps_${sha256Hex(canonicalJson({ members, overrides_sha256: overridesSha256 })).slice(0, 16)}`;
}
