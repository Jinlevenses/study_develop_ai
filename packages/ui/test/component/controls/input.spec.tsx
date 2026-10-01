import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImeSafeInput, isImeComposing } from '../../../src/components/ime-safe-input.js';
import { Input } from '../../../src/components/input.js';

afterEach(cleanup);

function enter(el: Element, init: { isComposing?: boolean; keyCode?: number } = {}): boolean {
  const ev = createEvent.keyDown(el, { key: 'Enter', code: 'Enter', keyCode: init.keyCode ?? 13 });
  Object.defineProperty(ev, 'isComposing', { value: init.isComposing === true });
  return fireEvent(el, ev);
}

describe('Input', () => {
  it('UT-UI-009 기본 클래스를 가진다 [FR-UX-004]', () => {
    render(<Input aria-label="이름" />);
    const el = screen.getByRole('textbox', { name: '이름' });
    for (const c of ['border-border-input', 'bg-surface-2', 'rounded-control']) {
      expect(el.className).toContain(c);
    }
  });

  it('UT-UI-010 invalid + errorMessage는 aria-invalid·aria-describedby·메시지를 연결한다 [FR-UX-004]', () => {
    render(<Input aria-label="이름" invalid errorMessage="이름을 입력하세요" />);
    const el = screen.getByRole('textbox', { name: '이름' });
    expect(el.getAttribute('aria-invalid')).toBe('true');
    const msg = screen.getByText('이름을 입력하세요');
    expect(msg.id).not.toBe('');
    expect(el.getAttribute('aria-describedby')).toBe(msg.id);
  });

  it('UT-UI-011 size="sm"은 h-7이다 [FR-UX-004]', () => {
    render(<Input aria-label="작은 입력" size="sm" />);
    expect(screen.getByRole('textbox').className).toContain('h-7');
  });
});

describe('ImeSafeInput', () => {
  it('UT-UI-012 isComposing Enter는 onEnter 0회이고 defaultPrevented이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeInput aria-label="검색" onEnter={onEnter} />);
    const notPrevented = enter(screen.getByRole('textbox'), { isComposing: true });
    expect(onEnter).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('UT-UI-013 keyCode 229 Enter는 onEnter 0회이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeInput aria-label="검색" onEnter={onEnter} />);
    enter(screen.getByRole('textbox'), { keyCode: 229 });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('UT-UI-014 compositionStart 뒤 Enter는 0회, compositionEnd 뒤 Enter는 1회이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    render(<ImeSafeInput aria-label="검색" onEnter={onEnter} />);
    const el = screen.getByRole('textbox');
    fireEvent.compositionStart(el);
    enter(el);
    expect(onEnter).toHaveBeenCalledTimes(0);
    fireEvent.compositionEnd(el);
    enter(el);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-015 조합 아님 Enter는 1회이고 사용자 onKeyDown이 preventDefault하면 0회이다 [FR-UX-004]', () => {
    const onEnter = vi.fn();
    const { rerender } = render(<ImeSafeInput aria-label="검색" onEnter={onEnter} />);
    enter(screen.getByRole('textbox'));
    expect(onEnter).toHaveBeenCalledTimes(1);
    rerender(<ImeSafeInput aria-label="검색" onEnter={onEnter} onKeyDown={(e) => e.preventDefault()} />);
    enter(screen.getByRole('textbox'));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-016 폼 안 조합 중 Enter는 submit 0회이고 isImeComposing 순수 함수가 3케이스를 가른다 [FR-UX-004]', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ImeSafeInput aria-label="검색" />
        <button type="submit">전송</button>
      </form>,
    );
    enter(screen.getByRole('textbox'), { isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(isImeComposing({ nativeEvent: { isComposing: true }, keyCode: 13 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
  });
});
