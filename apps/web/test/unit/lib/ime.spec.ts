import { describe, expect, it } from 'vitest';
import { isImeComposing } from '../../../src/lib/ime.js';

describe('ime', () => {
  it('UT-WEB-033 isImeComposing은 네이티브·React 합성 이벤트 형태와 keyCode 229를 모두 인식한다 [FR-UX-004]', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeComposing({ nativeEvent: { isComposing: false } })).toBe(false);
    expect(isImeComposing({})).toBe(false);
    expect(isImeComposing(new KeyboardEvent('keydown', { isComposing: true }))).toBe(true);
  });
});
