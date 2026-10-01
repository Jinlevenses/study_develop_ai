import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Select } from '../../../src/components/select.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(cleanup);
afterAll(() => undefined);

const OPTIONS = [
  { value: 'a', label: '알파' },
  { value: 'b', label: '베타', disabled: true },
  { value: 'c', label: '감마' },
] as const;

describe('Select', () => {
  it('UT-UI-022 닫힌 상태에서 aria-label·선택 값 라벨·ChevronDown을 보인다 [FR-UX-003]', () => {
    const { container } = render(
      <Select aria-label="항목" options={OPTIONS} value="c" onValueChange={() => undefined} />,
    );
    const trigger = screen.getByRole('combobox', { name: '항목' });
    expect(trigger.textContent).toContain('감마');
    expect(container.querySelector('svg.lucide-chevron-down')).not.toBeNull();
  });

  it('UT-UI-023 defaultOpen은 listbox·옵션 n개·disabled 옵션 data-disabled를 보인다 [FR-UX-003]', () => {
    render(<Select aria-label="항목" options={OPTIONS} defaultOpen />);
    expect(screen.getByRole('listbox')).not.toBeNull();
    const opts = screen.getAllByRole('option');
    expect(opts).toHaveLength(3);
    expect(opts[1]?.hasAttribute('data-disabled')).toBe(true);
    expect(opts[0]?.hasAttribute('data-disabled')).toBe(false);
  });

  it('UT-UI-024 열린 상태에서 옵션을 선택하면 onValueChange가 1회 호출된다 [FR-UX-003]', () => {
    const onValueChange = vi.fn();
    render(<Select aria-label="항목" options={OPTIONS} defaultOpen onValueChange={onValueChange} />);
    const target = screen.getByRole('option', { name: '감마' });
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('c');
  });
});
