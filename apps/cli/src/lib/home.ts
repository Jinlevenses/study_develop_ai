import path from 'node:path';
import { resolveFathomHome } from '@fathom/shared-kernel/config/config';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Profile } from './args.js';
import type { CliDeps } from './deps.js';
import { inside } from './inside.js';

// ADR-012 §6 · ARC-01 §9.1·§14.1 — FATHOM_HOME 결정과 사전 검사(경고는 실패가 아니다).
export const MIN_NODE = [22, 15, 0] as const;

export function resolveCliHome(
  profile: Profile,
  deps: Pick<CliDeps, 'env' | 'platform' | 'appRoot'>,
): Result<string, { message: string }> {
  if (profile === 'dev') {
    const dev = inside(deps.appRoot, '.fathom-dev');
    return dev === null ? err({ message: '앱 경로가 올바르지 않습니다' }) : ok(dev);
  }
  if (profile === 'test') {
    const home = deps.env('FATHOM_HOME');
    if (home === undefined || home === '' || !path.isAbsolute(home)) {
      return err({ message: '--profile=test에는 절대 경로의 FATHOM_HOME이 필요합니다' });
    }
    return ok(home);
  }
  try {
    return ok(resolveFathomHome({ platform: deps.platform, env: deps.env }));
  } catch {
    return err({ message: 'FATHOM_HOME은 절대 경로여야 합니다' });
  }
}

/** `v22.22.2` 형식. 22.15.0 이상이면 true. */
export function nodeVersionOk(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (m === null) {
    return false;
  }
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    const have = parts[i] ?? 0;
    const need = MIN_NODE[i] ?? 0;
    if (have !== need) {
      return have > need;
    }
  }
  return true;
}

const SYNC_SEGMENTS = ['onedrive', 'icloud', 'mobile documents', 'dropbox', 'google drive'];

/** 동기화 폴더·네트워크 경로·WSL 경로 휴리스틱 → 경고 문장 목록. */
export function homeWarnings(home: string, platform: NodeJS.Platform): string[] {
  const warnings: string[] = [];
  const segments = home.split(/[\\/]+/).map((s) => s.toLowerCase());
  const sync = SYNC_SEGMENTS.find((name) =>
    segments.some((s) => s === name || s.startsWith(`${name} -`) || s.startsWith(`${name}-`)),
  );
  if (sync !== undefined) {
    warnings.push(
      `데이터 폴더가 동기화 폴더(${sync}) 안에 있습니다. 파일 잠금·손상 위험이 있어 로컬 폴더를 권장합니다.`,
    );
  }
  if (home.startsWith('\\\\wsl$') || home.toLowerCase().startsWith('\\\\wsl.localhost')) {
    warnings.push('데이터 폴더가 WSL 경로입니다. Windows 쪽에서 접근하면 느리거나 잠금이 깨질 수 있습니다.');
  } else if (home.startsWith('\\\\')) {
    warnings.push('데이터 폴더가 네트워크(UNC) 경로입니다. SQLite 잠금이 보장되지 않아 로컬 폴더를 권장합니다.');
  }
  if (platform === 'linux' && /^\/mnt\/[a-z](\/|$)/.test(home)) {
    warnings.push(
      '데이터 폴더가 Windows 드라이브(/mnt/<드라이브>)에 있습니다. WSL에서는 느리고 잠금이 깨질 수 있습니다.',
    );
  }
  return warnings;
}
