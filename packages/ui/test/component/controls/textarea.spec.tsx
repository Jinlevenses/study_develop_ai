import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImeSafeTextarea } from '../../../src/components/ime-safe-textarea.js';
import { Textarea } from '../../../src/components/textarea.js';

afterEach(cleanup);

function enter(
  el: Element,
  init: { isComposing?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
): boolean {
  const ev = createEvent.keyDown(el, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    shiftKey: init.shiftKey === true,
    metaKey: init.metaKey === true,
    ctrlKey: init.ctrlKey === true,
  });
  Object.defineProperty(ev, 'isComposing', { value: init.isComposing === true });
  return fireEvent(el, ev);
}

describe('Textarea', () => {
  it('UT-UI-017 autoResize는 field-sizing-content를 넣고 없으면 넣지 않는다 [FR-UX-004]', () => {
    const { rerender } = render(<Textarea aria-label="메모" autoResize />);
    expect(screen.getByRole('textbox').className).toContain('field-sizing-content');
    rerender(<Textarea aria-label="메모" />);
    expect(screen.getByRole('textbox').className).not.toContain('field-sizing-content');
  });
});

describe('ImeSafeTextarea', () => {
  it('UT-UI-018 Ctrl/Cmd+Enter는 onSubmitShortcut 1회이고 조합 중이면 0회이다 [FR-UX-004]', () => {
    const onSubmitShortcut = vi.fn();
    render(<ImeSafeTextarea aria-label="메모" onSubmitShortcut={onSubmitShortcut} />);
    const el = screen.getByRole('textbox');
    enter(el, { ctrlKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(1);
    enter(el, { metaKey: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(2);
    enter(el, { ctrlKey: true, isComposing: true });
    expect(onSubmitShortcut).toHaveBeenCalledTimes(2);
  });

  it('UT-UI-019 submitOnEnter는 Enter = onEnter 1회·defaultPrevented, Shift+Enter = 0회이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeTextarea aria-label="메모" submitOnEnter onEnter={onEnter} />);
    const el = screen.getByRole('textbox');
    expect(enter(el)).toBe(false);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(enter(el, { shiftKey: true })).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-020 submitOnEnter 기본 false는 Enter가 onEnter를 부르지 않는다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeTextarea aria-label="메모" onEnter={onEnter} />);
    expect(enter(screen.getByRole('textbox'))).toBe(true);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('UT-UI-021 조합 중 Enter(submitOnEnter)는 0회이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeTextarea aria-label="메모" submitOnEnter onEnter={onEnter} />);
    const el = screen.getByRole('textbox');
    enter(el, { isComposing: true });
    fireEvent.compositionStart(el);
    enter(el);
    expect(onEnter).not.toHaveBeenCalled();
  });
});
