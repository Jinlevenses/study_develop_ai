import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Button } from '../../../src/components/button.js';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../../src/components/context-menu.js';
import { Drawer, DrawerContent } from '../../../src/components/drawer.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../src/components/dropdown-menu.js';
import { HOVER_CARD_DELAY, HoverCard, HoverCardContent, HoverCardTrigger } from '../../../src/components/hover-card.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../../src/components/popover.js';
import { TOOLTIP_DELAY_MS, Tooltip } from '../../../src/components/tooltip.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(cleanup);

describe('Drawer', () => {
  it('UT-UI-048 side right는 w-100·rounded-l-popover, left는 w-90이다 [FR-UX-010]', () => {
    const { unmount } = render(
      <Drawer defaultOpen>
        <DrawerContent title="판정 카드">본문</DrawerContent>
      </Drawer>,
    );
    const right = screen.getByRole('dialog');
    expect(right.className).toContain('w-100');
    expect(right.className).toContain('rounded-l-popover');
    unmount();
    render(
      <Drawer defaultOpen>
        <DrawerContent title="판정 카드" side="left">
          본문
        </DrawerContent>
      </Drawer>,
    );
    const left = screen.getByRole('dialog');
    expect(left.className).toContain('w-90');
    expect(left.className).toContain('rounded-r-popover');
  });

  it('UT-UI-049 Drawer는 title이 role=dialog의 이름이다 [FR-UX-010]', () => {
    render(
      <Drawer defaultOpen>
        <DrawerContent title="트랙 패널">본문</DrawerContent>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: '트랙 패널' })).not.toBeNull();
  });
});

describe('Popover · HoverCard · Tooltip', () => {
  it('UT-UI-050 Popover defaultOpen은 rounded-popover·shadow-popover·z-(--z-popover) 콘텐츠를 렌더한다 [FR-UX-010]', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button>열기</Button>
        </PopoverTrigger>
        <PopoverContent>내용</PopoverContent>
      </Popover>,
    );
    const content = screen.getByText('내용');
    for (const c of ['rounded-popover', 'shadow-popover', 'z-(--z-popover)']) {
      expect(content.className).toContain(c);
    }
  });

  it('UT-UI-051 HOVER_CARD_DELAY와 HoverCard defaultOpen 콘텐츠를 검증한다 [FR-UX-010]', () => {
    expect(HOVER_CARD_DELAY).toEqual({ open: 400, close: 150 });
    render(
      <HoverCard defaultOpen>
        <HoverCardTrigger asChild>
          <a href="/c">개념</a>
        </HoverCardTrigger>
        <HoverCardContent>미리보기</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByText('미리보기').className).toContain('rounded-popover');
  });

  it('UT-UI-052 Tooltip defaultOpen은 Provider 없이 role=tooltip을 렌더하고 지연은 500ms이다 [FR-UX-010]', () => {
    expect(TOOLTIP_DELAY_MS).toBe(500);
    render(
      <Tooltip content="잠정" defaultOpen>
        <button type="button">배지</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip').textContent).toBe('잠정');
  });

  it('UT-UI-053 트리거 focus는 툴팁을 보여 준다 [FR-UX-003]', () => {
    render(
      <Tooltip content="도움말">
        <button type="button">도움</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: '도움' }));
    expect(screen.getByRole('tooltip').textContent).toBe('도움말');
  });
});

describe('DropdownMenu · ContextMenu', () => {
  it('UT-UI-054 DropdownMenu defaultOpen은 menu·menuitem n개·kbd 힌트를 렌더하고 항목 클릭은 onSelect 1회이다 [FR-UX-010]', () => {
    const onSelect = vi.fn();
    const { baseElement } = render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <Button>메뉴</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem kbd={['Mod', 'E']} onSelect={onSelect}>
            편집
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger>삭제</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(baseElement.querySelector('[role="menuitem"] kbd')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /삭제/ }).className).toContain('text-incorrect');
    fireEvent.click(screen.getByRole('menuitem', { name: /편집/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-055 ContextMenu 트리거의 contextMenu 이벤트는 role=menu를 연다 [FR-UX-010]', () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>우클릭 영역</div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>복사</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByText('우클릭 영역'), { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: '복사' })).not.toBeNull();
  });
});
