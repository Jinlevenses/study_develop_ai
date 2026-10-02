import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Logger } from '@fathom/shared-kernel/log/log';
import { parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import type { PromptState, RegistryView } from '../../domain/control/answer-gate.js';
import { verifyPromptLock } from '../../domain/generate/prompt-registry.js';
import { parseTaskRegistry } from '../../domain/routing/task-registry.js';

// ARC-01 §856 — 기동 시 1회: `tasks.yaml` 검증 + `prompts.lock.json` 대조(동기 fs 허용). routing·generate 도메인 결과를
// control 타입(`RegistryView`)으로 옮기는 결선은 BC 밖인 이 파일이 맡는다(Brief §4.3, check:boundaries bc-cross).

const PROMPT_ROOTS = ['prompts', 'jev/prompts'] as const;

function listFiles(root: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true, recursive: true });
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return [];
    }
    throw cause;
  }
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

function promptFiles(assetsDir: string): { path: string; sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  for (const rootRel of PROMPT_ROOTS) {
    const root = path.join(assetsDir, ...rootRel.split('/'));
    for (const file of listFiles(root)) {
      const rel = path.relative(assetsDir, file).split(path.sep).join('/');
      out.push({ path: rel, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
    }
  }
  return out;
}

function readLock(assetsDir: string): unknown {
  try {
    return parseJsonStrict(readFileSync(path.join(assetsDir, 'prompts.lock.json'), 'utf8'));
  } catch {
    return null; // 읽기·파싱 실패 = 형식 위반과 같다(lock_ok false, 프롬프트를 가진 과업 비활성)
  }
}

export function loadRegistryView(assetsDir: string, log: Logger): RegistryView {
  const parsedYaml = parseYamlStrict(readFileSync(path.join(assetsDir, 'tasks.yaml'), 'utf8'));
  if (!parsedYaml.ok) {
    throw new Error(`invariant: tasks.yaml ${parsedYaml.error.detail}`);
  }
  const registry = parseTaskRegistry(parsedYaml.value);
  if (!registry.ok) {
    throw new Error(`invariant: tasks.yaml ${registry.error.detail}`);
  }
  const report = verifyPromptLock({ lock: readLock(assetsDir), files: promptFiles(assetsDir) });

  const tasks = new Map<string, { kind: 'judge' | 'generate'; lane: 'interactive' | 'conversational' | 'background'; prompt: PromptState }>();
  for (const [id, entry] of registry.value) {
    tasks.set(id, { kind: entry.kind, lane: entry.lane, prompt: report.per_task[id] ?? 'absent' });
  }
  const mismatchedTasks = [...tasks].filter(([, t]) => t.prompt === 'mismatch').map(([id]) => id);
  if (report.mismatched_files.length > 0) {
    log.warn(
      { event: 'registry.prompt_lock_mismatch', tasks: mismatchedTasks, files: report.mismatched_files.length },
      'prompt lock mismatch',
    );
  }
  const warn = report.mismatched_files.length > 0;
  return {
    tasks,
    doctor: {
      id: 'prompts_lock',
      status: warn ? 'warn' : 'ok',
      summary_ko: warn
        ? `프롬프트 잠금이 맞지 않는 과업 ${mismatchedTasks.length}개를 껐습니다`
        : '프롬프트 잠금이 일치합니다',
      mismatched_tasks: mismatchedTasks,
    },
  };
}
