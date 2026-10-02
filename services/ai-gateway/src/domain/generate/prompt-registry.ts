import { GenerateTaskId, JudgeTaskId } from '@fathom/contracts/ai/tasks';

// ARC-01 §856 — `prompts.lock.json` 대조: 불일치 과업만 비활성(task_disabled), 파일이 아예 없는 과업은 `absent`(Brief §4.3). 순수.

export type PromptLockReport = {
  readonly lock_ok: boolean;
  readonly per_task: Readonly<Record<string, 'ok' | 'absent' | 'mismatch'>>;
  readonly mismatched_files: readonly string[];
};

const SHA256_RE = /^[0-9a-f]{64}$/;
const TASK_PATH_RE = /^(?:jev\/)?prompts\/(AI-[JG]\d{2})\//;
const ALL_TASKS: readonly string[] = [...JudgeTaskId.options, ...GenerateTaskId.options];
const ALL_TASK_SET: ReadonlySet<string> = new Set(ALL_TASKS);

/** 경로 → 과업 ID. `_partials`·`_system`·그 밖·미등록 ID = null(전역 — 과업 비활성 0). */
export function taskOfPromptPath(path: string): string | null {
  const id = TASK_PATH_RE.exec(path)?.[1];
  return id !== undefined && ALL_TASK_SET.has(id) ? id : null;
}

function isLockMap(lock: unknown): lock is Readonly<Record<string, string>> {
  if (typeof lock !== 'object' || lock === null || Array.isArray(lock)) {
    return false;
  }
  return Object.values(lock).every((v) => typeof v === 'string' && SHA256_RE.test(v));
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `lock` = `{ "<assets 기준 posix 상대 경로>": "<sha256 소문자 64hex>" }`. 경로 ∈ lock ∪ files 각각에서 한쪽에만 있거나
 * 해시가 다르면 불일치 파일. 과업 상태: 불일치 파일 ≥ 1 → mismatch · 일치하는 `…/prompt.md` ≥ 1 → ok · 그 밖 → absent.
 * 형식 위반 lock = `lock_ok: false` + 프롬프트 파일을 가진 모든 과업 mismatch(검증 불능 → 전체 파일을 불일치로 본다).
 */
export function verifyPromptLock(input: {
  readonly lock: unknown;
  readonly files: readonly { path: string; sha256: string }[];
}): PromptLockReport {
  const perTask: Record<string, 'ok' | 'absent' | 'mismatch'> = Object.fromEntries(ALL_TASKS.map((t) => [t, 'absent']));
  const fileHash = new Map(input.files.map((f) => [f.path, f.sha256]));

  if (!isLockMap(input.lock)) {
    for (const path of fileHash.keys()) {
      const task = taskOfPromptPath(path);
      if (task !== null) {
        perTask[task] = 'mismatch';
      }
    }
    return { lock_ok: false, per_task: perTask, mismatched_files: [...fileHash.keys()].sort(byCode) };
  }

  const lock = input.lock;
  const mismatched: string[] = [];
  const matchedPrompts = new Set<string>();
  const paths = new Set<string>([...Object.keys(lock), ...fileHash.keys()]);
  for (const path of paths) {
    const locked = Object.hasOwn(lock, path) ? lock[path] : undefined;
    const actual = fileHash.get(path);
    if (locked === undefined || actual === undefined || locked !== actual) {
      mismatched.push(path);
      continue;
    }
    const task = taskOfPromptPath(path);
    if (task !== null && path.endsWith('/prompt.md')) {
      matchedPrompts.add(task);
    }
  }
  for (const task of matchedPrompts) {
    perTask[task] = 'ok';
  }
  for (const path of mismatched) {
    const task = taskOfPromptPath(path);
    if (task !== null) {
      perTask[task] = 'mismatch';
    }
  }
  mismatched.sort(byCode);
  return { lock_ok: mismatched.length === 0, per_task: perTask, mismatched_files: mismatched };
}
