import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AlertDialog } from '../../../src/components/alert-dialog.js';
import { ConfirmByName } from '../../../src/components/confirm-by-name.js';
import { Dialog, DialogContent } from '../../../src/components/dialog.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(cleanup);

function enter(el: Element, isComposing = false): void {
  const ev = createEvent.keyDown(el, { key: 'Enter', code: 'Enter', keyCode: 13 });
  Object.defineProperty(ev, 'isComposing', { value: isComposing });
  fireEvent(el, ev);
}

describe('Dialog', () => {
  it('UT-UI-040 defaultOpen은 role=dialog·aria-labelledby=title·description 연결을 가진다 [FR-UX-010]', () => {
    render(
      <Dialog defaultOpen>
        <DialogContent title="설정 변경" description="변경 내용을 확인하세요">
          본문
        </DialogContent>
      </Dialog>,
    );
    const dlg = screen.getByRole('dialog');
    const title = screen.getByText('설정 변경');
    const desc = screen.getByText('변경 내용을 확인하세요');
    expect(dlg.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dlg.getAttribute('aria-describedby')).toBe(desc.id);
  });

  it('UT-UI-041 Esc와 닫기 버튼은 onOpenChange(false)를 호출한다 [FR-UX-010]', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <DialogContent title="제목">본문</DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    cleanup();
    render(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <DialogContent title="제목">본문</DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('UT-UI-042 크기별 max-w 클래스와 glass는 overlay에만 backdrop-blur-glass를 넣는다 [FR-UX-010]', () => {
    const widths: ['sm' | 'md' | 'lg', string][] = [
      ['sm', 'max-w-100'],
      ['md', 'max-w-130'],
      ['lg', 'max-w-180'],
    ];
    for (const [size, cls] of widths) {
      const { unmount } = render(
        <Dialog defaultOpen>
          <DialogContent title="제목" size={size}>
            본문
          </DialogContent>
        </Dialog>,
      );
      expect(screen.getByRole('dialog').className).toContain(cls);
      unmount();
    }
    const plain = render(
      <Dialog defaultOpen>
        <DialogContent title="제목">본문</DialogContent>
      </Dialog>,
    );
    expect(document.body.innerHTML).not.toContain('backdrop-blur-glass');
    plain.unmount();
    render(
      <Dialog defaultOpen>
        <DialogContent title="제목" glass>
          본문
        </DialogContent>
      </Dialog>,
    );
    const overlay = document.querySelector('.bg-scrim');
    expect(overlay?.className).toContain('backdrop-blur-glass');
    expect(screen.getByRole('dialog').className).not.toContain('backdrop-blur-glass');
  });
});

describe('AlertDialog', () => {
  it('UT-UI-043 role=alertdialog이고 취소가 확인보다 DOM 앞이며 cancelLabel 기본은 취소이다 [FR-UX-010]', () => {
    render(
      <AlertDialog
        open
        title="삭제"
        description="되돌릴 수 없습니다"
        confirmLabel="삭제"
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole('alertdialog')).not.toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['취소', '삭제']);
  });

  it('UT-UI-044 확인 클릭은 onConfirm 1회이고 danger는 bg-danger이다 [FR-UX-010]', () => {
    const onConfirm = vi.fn();
    render(<AlertDialog open danger title="삭제" description="설명" confirmLabel="삭제하기" onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: '삭제하기' });
    expect(confirm.className).toContain('bg-danger');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmByName', () => {
  function setup(onConfirm = vi.fn()): { onConfirm: ReturnType<typeof vi.fn>; rerender: (open: boolean) => void } {
    const ui = (open: boolean) => (
      <ConfirmByName
        open={open}
        onOpenChange={() => undefined}
        title="환경 삭제"
        name="prod"
        confirmLabel="삭제"
        onConfirm={onConfirm}
      />
    );
    const r = render(ui(true));
    return { onConfirm, rerender: (open) => r.rerender(ui(open)) };
  }

  it('UT-UI-045 입력이 비었거나 대소문자가 다르면 확인 버튼이 disabled이다 [FR-UX-010]', () => {
    setup();
    const confirm = screen.getByRole('button', { name: '삭제' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Prod' } });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText('확인하려면 "prod"을 입력하세요')).not.toBeNull();
  });

  it('UT-UI-046 정확 일치는 활성·클릭 1회, 일치 상태 Enter 1회, 조합 중 Enter 0회이다 [FR-UX-010][FR-UX-004]', () => {
    const { onConfirm } = setup();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'prod' } });
    const confirm = screen.getByRole('button', { name: '삭제' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    enter(input, true);
    expect(onConfirm).toHaveBeenCalledTimes(0);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    enter(input);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('UT-UI-047 닫았다 다시 열면 입력이 초기화된다 [FR-UX-010]', () => {
    const { rerender } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'prod' } });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('prod');
    act(() => rerender(false));
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => rerender(true));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});
