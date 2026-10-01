import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../../src/components/command.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(cleanup);

function palette(
  props: Partial<React.ComponentProps<typeof Command>> = {},
  onSelect = vi.fn(),
): ReturnType<typeof vi.fn> {
  render(
    <Command label="명령" {...props}>
      <CommandInput placeholder="검색" />
      <CommandList>
        <CommandEmpty />
        <CommandItem value="Docker" onSelect={onSelect}>
          Docker
        </CommandItem>
        <CommandItem value="도커">도커</CommandItem>
        <CommandItem value="Git">Git</CommandItem>
      </CommandList>
    </Command>,
  );
  return onSelect;
}

describe('Command', () => {
  it('UT-UI-056 기본 필터는 doc 입력에 Docker만 남기고 없으면 결과가 없습니다를 보인다 [FR-UX-005]', () => {
    palette();
    const input = screen.getByPlaceholderText('검색');
    fireEvent.change(input, { target: { value: 'doc' } });
    const items = screen.getAllByRole('option');
    expect(items.map((i) => i.textContent)).toEqual(['Docker']);
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('결과가 없습니다')).not.toBeNull();
  });

  it('UT-UI-057 주입한 filter가 초성 입력에 도커를 표시하고 호출된다 [FR-UX-005]', () => {
    const table: Record<string, string> = { ㄷㅋ: '도커' };
    const filter = vi.fn((value: string, search: string): number => (table[search] === value ? 1 : 0));
    palette({ filter });
    fireEvent.change(screen.getByPlaceholderText('검색'), { target: { value: 'ㄷㅋ' } });
    expect(filter.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('option').map((i) => i.textContent)).toEqual(['도커']);
  });

  it('UT-UI-058 항목 Enter는 onSelect 1회이고 isComposing Enter는 0회이다 [FR-UX-005][FR-UX-004]', () => {
    const onSelect = palette();
    const root = document.querySelector('[cmdk-root]');
    expect(root).not.toBeNull();
    const composing = createEvent.keyDown(root as Element, { key: 'Enter', code: 'Enter', keyCode: 13 });
    Object.defineProperty(composing, 'isComposing', { value: true });
    fireEvent(root as Element, composing);
    expect(onSelect).toHaveBeenCalledTimes(0);
    fireEvent.keyDown(root as Element, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
