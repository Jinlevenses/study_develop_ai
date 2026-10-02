import { GenerateTaskId, JudgeTaskId, TaskRegistryEntry } from '@fathom/contracts/ai/tasks';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// ADR-005 §4 · AI-01 §6.2 — `tasks.yaml` 레지스트리 검증. 순수(파일 읽기는 infra/assets/registry-loader.ts).
// `SystemTaskId`(SYS-*)는 레지스트리 밖이다(HTTP 라우팅 불가, D-AI-10).

export type TaskId = JudgeTaskId | GenerateTaskId;
export type RegistryInvalid = { readonly kind: 'registry_invalid'; readonly detail: string };

const EXPECTED_KEYS: readonly string[] = [...JudgeTaskId.options, ...GenerateTaskId.options];
const DEFAULTS_KEY = '_defaults';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskId(key: string): key is TaskId {
  return JudgeTaskId.safeParse(key).success || GenerateTaskId.safeParse(key).success;
}

/**
 * 최상위 객체 · `_defaults` 무시 · 나머지 키 = `JudgeTaskId ∪ GenerateTaskId` 32개와 정확히 일치(누락·초과 = err)
 * · 값 = `TaskRegistryEntry` · `prompt.id === 키`.
 */
export function parseTaskRegistry(raw: unknown): Result<ReadonlyMap<TaskId, TaskRegistryEntry>, RegistryInvalid> {
  if (!isRecord(raw)) {
    return err({ kind: 'registry_invalid', detail: 'tasks.yaml root must be a mapping' });
  }
  const keys = Object.keys(raw).filter((k) => k !== DEFAULTS_KEY);
  const missing = EXPECTED_KEYS.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    return err({ kind: 'registry_invalid', detail: `missing tasks: ${missing.join(', ')}` });
  }
  const extra = keys.filter((k) => !EXPECTED_KEYS.includes(k));
  if (extra.length > 0) {
    return err({ kind: 'registry_invalid', detail: `unknown tasks: ${extra.join(', ')}` });
  }
  const tasks = new Map<TaskId, TaskRegistryEntry>();
  for (const key of keys) {
    if (!isTaskId(key)) {
      return err({ kind: 'registry_invalid', detail: `unknown task: ${key}` });
    }
    const parsed = TaskRegistryEntry.safeParse(raw[key]);
    if (!parsed.success) {
      return err({
        kind: 'registry_invalid',
        detail: `${key}: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      });
    }
    if (parsed.data.prompt?.id !== key) {
      return err({ kind: 'registry_invalid', detail: `${key}: prompt.id must equal the task key` });
    }
    tasks.set(key, parsed.data);
  }
  return ok(tasks);
}
