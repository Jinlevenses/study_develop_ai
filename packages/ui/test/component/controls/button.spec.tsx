import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bold } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from '../../../src/components/button.js';
import { IconButton } from '../../../src/components/icon-button.js';
import { Kbd } from '../../../src/components/kbd.js';
import { cn } from '../../../src/lib/cn.js';

afterEach(cleanup);

describe('Button', () => {
  it('UT-UI-001 기본 type="button"이고 primary 클래스를 가진다 [FR-UX-003]', () => {
    render(<Button>저장</Button>);
    const el = screen.getByRole('button', { name: '저장' });
    expect(el.getAttribute('type')).toBe('button');
    expect(el.className).toContain('bg-primary');
    expect(el.className).toContain('text-on-primary');
  });

  it('UT-UI-002 5변형·3크기 핵심 클래스와 cn 병합이 표와 같다 [FR-UX-003]', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-primary text-on-primary');
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-surface-2 border border-border-input text-fg');
    expect(buttonVariants({ variant: 'ghost' })).toContain('bg-transparent text-fg hover:bg-state-hover');
    expect(buttonVariants({ variant: 'danger' })).toContain('bg-danger text-on-danger');
    expect(buttonVariants({ variant: 'link' })).toContain('text-fg underline underline-offset-4');
    expect(buttonVariants({ size: 'sm' })).toContain('h-7 px-2 text-sm');
    expect(buttonVariants({ size: 'md' })).toContain('h-(--control-h) px-(--control-px) text-sm');
    expect(buttonVariants({ size: 'lg' })).toContain('h-11 px-5 text-base');
    expect(buttonVariants()).toContain('inline-flex items-center');
    expect(buttonVariants()).toContain(
      'rounded-control font-medium transition-colors duration-(--dur-instant) ease-standard',
    );
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-read', 'text-fg').split(' ')).toEqual(['text-read', 'text-fg']);
    expect(cn('text-sm', 'text-read')).toBe('text-read');
    expect(cn('font-mono', 'font-book').split(' ')).toEqual(['font-mono', 'font-book']);
    expect(cn('rounded-control', 'rounded-panel')).toBe('rounded-panel');
  });

  it('UT-UI-003 loading은 disabled·aria-busy·라벨 유지·클릭 0회이고 disabled는 aria-disabled이다 [FR-UX-003]', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading onClick={onClick}>
        전송
      </Button>,
    );
    const el = screen.getByRole('button', { name: '전송' }) as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toBe('전송');
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button disabled>전송</Button>);
    expect(screen.getByRole('button').getAttribute('aria-disabled')).toBe('true');
  });

  it('UT-UI-004 kbd는 내부 <kbd>를 렌더하고 asChild는 <a>로 클래스를 옮긴다 [FR-UX-003]', () => {
    const { container, unmount } = render(<Button kbd={['Mod', 'K']}>열기</Button>);
    expect(container.querySelector('button kbd')).not.toBeNull();
    unmount();
    render(
      <Button asChild variant="secondary">
        <a href="/x">이동</a>
      </Button>,
    );
    const a = screen.getByRole('link', { name: '이동' });
    expect(a.tagName).toBe('A');
    expect(a.className).toContain('bg-surface-2');
    expect(a.getAttribute('type')).toBeNull();
  });
});

describe('IconButton', () => {
  it('UT-UI-005 aria-label이 접근 가능한 이름이고 아이콘은 aria-hidden이다 [FR-UX-003]', () => {
    render(<IconButton aria-label="굵게" icon={Bold} />);
    const el = screen.getByRole('button', { name: '굵게' });
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('UT-UI-006 크기 sm은 size-7, md는 size-8이다 [FR-UX-003]', () => {
    render(
      <>
        <IconButton aria-label="작게" icon={Bold} size="sm" />
        <IconButton aria-label="보통" icon={Bold} size="md" />
      </>,
    );
    expect(screen.getByRole('button', { name: '작게' }).className).toContain('size-7');
    expect(screen.getByRole('button', { name: '보통' }).className).toContain('size-8');
  });
});

describe('Kbd', () => {
  it('UT-UI-007 mac은 이어 붙이고 other는 +로 연결한다 [FR-UX-003]', () => {
    const { container, rerender } = render(<Kbd platform="mac" keys={['Mod', 'K']} />);
    expect(container.textContent).toBe('⌘K');
    rerender(<Kbd platform="other" keys={['Mod', 'K']} />);
    expect(container.textContent).toBe('Ctrl+K');
    rerender(<Kbd platform="mac" keys={['Mod', 'Shift', 'P']} />);
    expect(container.textContent).toBe('⌘⇧P');
  });

  it('UT-UI-008 클래스 font-mono·text-2xs·rounded-inline을 가진다 [FR-UX-003]', () => {
    const { container } = render(<Kbd platform="other" keys={['Esc']} />);
    const el = container.querySelector('kbd');
    expect(el?.className).toContain('font-mono');
    expect(el?.className).toContain('text-2xs');
    expect(el?.className).toContain('rounded-inline');
  });
});
