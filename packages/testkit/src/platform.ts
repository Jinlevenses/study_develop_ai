import { describe } from 'vitest';

/** 지정 플랫폼에서만 `describe`를 실행한다(`onlyOn('linux')('이름', () => {…})`). */
export function onlyOn(...platforms: NodeJS.Platform[]): ReturnType<typeof describe.runIf> {
  return describe.runIf(platforms.includes(process.platform));
}

/** 러너 플랫폼 검증 목록(`policy`의 검증된 플랫폼 표)에 현재 플랫폼이 있는지. */
export function runnerPlatformVerified(platform: NodeJS.Platform, verified: readonly string[]): boolean {
  return verified.includes(platform);
}
