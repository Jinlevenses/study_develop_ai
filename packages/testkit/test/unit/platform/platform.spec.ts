import { describe, expect, it } from 'vitest';
import { onlyOn, runnerPlatformVerified } from '../../../src/platform.js';

// onlyOn은 describe.runIf 결과를 돌려준다: 현재 플랫폼이면 describe 그대로, 아니면 describe가 아닌 skip 변형.
const current = onlyOn(process.platform);
const other: NodeJS.Platform = process.platform === 'linux' ? 'win32' : 'linux';
const foreign = onlyOn(other);

it('UT-TK-047 runnerPlatformVerified·onlyOn이 플랫폼을 판별한다 [NFR-PORT-001]', () => {
  expect(runnerPlatformVerified('linux', ['linux', 'darwin'])).toBe(true);
  expect(runnerPlatformVerified('win32', ['linux', 'darwin'])).toBe(false);
  expect(runnerPlatformVerified('linux', [])).toBe(false);
  expect(current).toBe(describe);
  expect(foreign).not.toBe(describe);
  expect(onlyOn(other, process.platform)).toBe(describe);
  expect(onlyOn()).not.toBe(describe);
});
