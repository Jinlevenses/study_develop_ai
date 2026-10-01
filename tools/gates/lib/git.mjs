import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { GateEngineError } from './errors.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = new GateEngineError(
      'engine/git',
      `git ${args.join(' ')} failed: ${
        String(e.stderr || e.message)
          .trim()
          .split('\n')[0]
      }`,
    );
    err.cause = e;
    throw err;
  }
}

function assertRef(base) {
  if (typeof base !== 'string' || base === '' || base.startsWith('-')) {
    throw new GateEngineError('engine/usage', `invalid base ref: ${JSON.stringify(base)}`);
  }
}

function readLines(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new GateEngineError('engine/input-missing', `cannot read ${file} (${e.code ?? e.message})`);
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * 변경 파일 목록(정렬·중복 제거, root 기준 상대 경로).
 * `changedFrom`(줄당 경로 1개 텍스트 파일)이 있으면 git을 부르지 않는다.
 */
export function changedFiles(root, { base = 'HEAD', changedFrom } = {}) {
  if (changedFrom) {
    return [...new Set(readLines(changedFrom))].sort();
  }
  assertRef(base);
  const set = new Set();
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) {
      continue;
    }
    const xy = entry.slice(0, 2);
    set.add(entry.slice(3));
    if (xy.includes('R') || xy.includes('C')) {
      i++;
      if (parts[i]) {
        set.add(parts[i]);
      }
    }
  }
  if (base !== 'HEAD') {
    const diff = git(root, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`]);
    for (const f of diff.split('\0')) {
      if (f) {
        set.add(f);
      }
    }
  }
  return [...set].sort();
}

/** `<base>..HEAD` 커밋 메시지 본문 + messageFile 내용. base = HEAD면 git 로그 부분은 빈 문자열. */
export function commitMessages(root, { base = 'HEAD', messageFile } = {}) {
  let text = '';
  if (base !== 'HEAD') {
    assertRef(base);
    text = git(root, ['log', '--format=%B', `${base}..HEAD`]);
  }
  if (messageFile) {
    let extra;
    try {
      extra = readFileSync(messageFile, 'utf8');
    } catch (e) {
      throw new GateEngineError('engine/input-missing', `cannot read ${messageFile} (${e.code ?? e.message})`);
    }
    text += (text && !text.endsWith('\n') ? '\n' : '') + extra;
  }
  return text;
}

/** `git show <base>:<rel>`. 그 기준에 없는 경로 = null. */
export function showAtBase(root, base, rel) {
  assertRef(base);
  try {
    return execFileSync('git', ['show', `${base}:${rel}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new GateEngineError('engine/git', 'git executable not found');
    }
    return null;
  }
}
