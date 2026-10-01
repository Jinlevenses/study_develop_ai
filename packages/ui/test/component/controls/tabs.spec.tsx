import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as button from '../../../src/components/button.js';
import * as checkbox from '../../../src/components/checkbox.js';
import * as iconButton from '../../../src/components/icon-button.js';
import * as imeSafeInput from '../../../src/components/ime-safe-input.js';
import * as imeSafeTextarea from '../../../src/components/ime-safe-textarea.js';
import * as input from '../../../src/components/input.js';
import * as kbd from '../../../src/components/kbd.js';
import * as radioGroup from '../../../src/components/radio-group.js';
import * as segmentedControl from '../../../src/components/segmented-control.js';
import * as select from '../../../src/components/select.js';
import * as switchMod from '../../../src/components/switch.js';
import * as tabs from '../../../src/components/tabs.js';
import { Tabs } from '../../../src/components/tabs.js';
import * as textarea from '../../../src/components/textarea.js';
import * as toggleGroup from '../../../src/components/toggle-group.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ITEMS = [
  { value: 'one', label: '하나', content: <p>첫 패널</p> },
  { value: 'two', label: '둘', content: <p>둘째 패널</p> },
  { value: 'three', label: '셋', content: <p>셋째 패널</p> },
] as const;

describe('Tabs', () => {
  it('UT-UI-034 tablist·탭 n개·첫 탭 선택·패널 1개를 보인다 [FR-UX-003]', () => {
    render(<Tabs aria-label="섹션" items={ITEMS} />);
    expect(screen.getByRole('tablist', { name: '섹션' })).not.toBeNull();
    const tabEls = screen.getAllByRole('tab');
    expect(tabEls).toHaveLength(3);
    expect(tabEls[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByText('첫 패널')).not.toBeNull();
  });

  it('UT-UI-035 manual 활성화: ArrowRight는 포커스만 옮기고 Enter가 선택한다 [FR-UX-003]', () => {
    vi.useFakeTimers();
    render(<Tabs aria-label="섹션" items={ITEMS} />);
    const [first, second] = screen.getAllByRole('tab');
    first?.focus();
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight', code: 'ArrowRight' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(document.activeElement).toBe(second);
    expect(first?.getAttribute('aria-selected')).toBe('true');
    expect(second?.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(second as HTMLElement, { key: 'Enter', code: 'Enter' });
    expect(second?.getAttribute('aria-selected')).toBe('true');
  });

  it('UT-UI-036 numberKeys: Digit2는 둘째 탭을 선택하고 Ctrl 동반이면 변하지 않는다 [FR-UX-003]', () => {
    render(<Tabs aria-label="섹션" items={ITEMS} numberKeys />);
    const list = screen.getByRole('tablist');
    const tabEls = screen.getAllByRole('tab');
    fireEvent.keyDown(list, { key: '3', code: 'Digit3', ctrlKey: true });
    expect(tabEls[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: '2', code: 'Digit2' });
    expect(tabEls[1]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabEls[1]);
  });
});

describe('controls 14파일 export', () => {
  it('UT-UI-037 컨트롤 14파일은 named export가 있고 default export가 없다 [FR-UX-003]', () => {
    const mods: [string, Record<string, unknown>, string][] = [
      ['button', button, 'Button'],
      ['icon-button', iconButton, 'IconButton'],
      ['kbd', kbd, 'Kbd'],
      ['input', input, 'Input'],
      ['ime-safe-input', imeSafeInput, 'ImeSafeInput'],
      ['textarea', textarea, 'Textarea'],
      ['ime-safe-textarea', imeSafeTextarea, 'ImeSafeTextarea'],
      ['select', select, 'Select'],
      ['checkbox', checkbox, 'Checkbox'],
      ['radio-group', radioGroup, 'RadioGroup'],
      ['switch', switchMod, 'Switch'],
      ['segmented-control', segmentedControl, 'SegmentedControl'],
      ['toggle-group', toggleGroup, 'ToggleGroup'],
      ['tabs', tabs, 'Tabs'],
    ];
    expect(mods).toHaveLength(14);
    for (const [name, mod, exported] of mods) {
      expect(typeof mod[exported], name).toBe('function');
      expect('default' in mod, `${name} default`).toBe(false);
    }
  });
});
