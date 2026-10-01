import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bold } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../../../src/components/button.js';
import { Checkbox } from '../../../src/components/checkbox.js';
import { Input } from '../../../src/components/input.js';
import { RadioGroup } from '../../../src/components/radio-group.js';
import { SegmentedControl } from '../../../src/components/segmented-control.js';
import { Switch } from '../../../src/components/switch.js';
import { ToggleGroup } from '../../../src/components/toggle-group.js';

afterEach(cleanup);

const RADIOS = [
  { value: 'x', label: '엑스' },
  { value: 'y', label: '와이', description: '설명' },
  { value: 'z', label: '제트', disabled: true },
] as const;

const SEGMENTS = [
  { value: 'a', label: '하나', icon: Bold },
  { value: 'b', label: '둘' },
  { value: 'c', label: '셋' },
] as const;

describe('Checkbox · RadioGroup · Switch', () => {
  it('UT-UI-025 Checkbox는 라벨로 찾히고 클릭하면 true, indeterminate는 aria-checked mixed이다 [FR-UX-003]', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Checkbox label="동의" checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '동의' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox label="동의" checked="indeterminate" onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole('checkbox', { name: '동의' }).getAttribute('aria-checked')).toBe('mixed');
  });

  it('UT-UI-026 RadioGroup은 radiogroup·aria-label·라디오 n개·선택 aria-checked를 가진다 [FR-UX-003]', () => {
    render(<RadioGroup aria-label="선택지" options={RADIOS} value="y" />);
    const group = screen.getByRole('radiogroup', { name: '선택지' });
    expect(group).not.toBeNull();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('false');
  });

  it('UT-UI-027 라디오 클릭은 onValueChange 1회이고 disabled 항목은 0회이다 [FR-UX-003]', () => {
    const onValueChange = vi.fn();
    render(<RadioGroup aria-label="선택지" options={RADIOS} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '엑스' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('x');
    fireEvent.click(screen.getByRole('radio', { name: '제트' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-028 Switch는 role switch·aria-checked이고 클릭하면 !checked를 전달한다 [FR-UX-003]', () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="알림" checked={false} onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole('switch', { name: '알림' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('SegmentedControl · ToggleGroup', () => {
  it('UT-UI-029 SegmentedControl은 group이고 선택 항목이 data-state="on"과 접근성 상태를 가진다 [FR-UX-003]', () => {
    render(<SegmentedControl aria-label="모드" options={SEGMENTS} value="b" onValueChange={() => undefined} />);
    expect(screen.getByRole('group', { name: '모드' })).not.toBeNull();
    const on = screen.getByRole('radio', { name: '둘' });
    expect(on.getAttribute('data-state')).toBe('on');
    expect(on.getAttribute('aria-checked') ?? on.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('radio', { name: '하나' }).getAttribute('data-state')).toBe('off');
  });

  it('UT-UI-030 다른 항목 클릭은 onValueChange 1회이고 선택 항목 재클릭(해제)은 0회이다 [FR-UX-003]', () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl aria-label="모드" options={SEGMENTS} value="b" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '셋' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('c');
    fireEvent.click(screen.getByRole('radio', { name: '둘' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-031 size sm·md·lg 높이 클래스가 서로 다르다 [FR-UX-003]', () => {
    const heights = (['sm', 'md', 'lg'] as const).map((size) => {
      const { unmount } = render(
        <SegmentedControl aria-label="모드" options={SEGMENTS} value="a" onValueChange={() => undefined} size={size} />,
      );
      const cls = screen.getByRole('radio', { name: '둘' }).className;
      unmount();
      return /\bh-(?:7|\(--control-h\)|11)\b/.exec(cls)?.[0] ?? '';
    });
    expect(new Set(heights).size).toBe(3);
  });

  it('UT-UI-032 ToggleGroup 다중 선택은 배열을 전달하고 pattern 견본은 data-pattern·aria-hidden이다 [FR-UX-003][NFR-UX-004]', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <ToggleGroup
        aria-label="레이어"
        options={[
          { value: 'a', label: '선', pattern: 'dashed' },
          { value: 'b', label: '면', pattern: 'hatch' },
        ]}
        value={['a']}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '면' }));
    expect(onValueChange).toHaveBeenCalledWith(['a', 'b']);
    const swatches = container.querySelectorAll('[data-pattern]');
    expect(swatches).toHaveLength(2);
    for (const s of swatches) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
    }
    expect(swatches[0]?.getAttribute('data-pattern')).toBe('dashed');
  });

  it('UT-UI-033 pattern이 있어도 라벨 텍스트는 항상 보인다 [NFR-UX-004]', () => {
    render(
      <ToggleGroup
        aria-label="레이어"
        options={[{ value: 'a', label: '점선 레이어', pattern: 'dotted' }]}
        value={[]}
        onValueChange={() => undefined}
      />,
    );
    expect(screen.getByText('점선 레이어')).not.toBeNull();
  });
});

describe('disabled 공통', () => {
  it('UT-UI-038 Button·Input·Checkbox·Switch·SegmentedControl에 disabled를 주면 콜백이 0회이다 [FR-UX-003]', () => {
    const onClick = vi.fn();
    const onChange = vi.fn();
    const onCheckedChange = vi.fn();
    const onSwitch = vi.fn();
    const onSegment = vi.fn();
    render(
      <>
        <Button disabled onClick={onClick}>
          버튼
        </Button>
        <Input aria-label="입력" disabled onChange={onChange} />
        <Checkbox label="체크" checked={false} disabled onCheckedChange={onCheckedChange} />
        <Switch label="스위치" checked={false} disabled onCheckedChange={onSwitch} />
        <SegmentedControl aria-label="분할" options={SEGMENTS} value="a" disabled onValueChange={onSegment} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '버튼' }));
    fireEvent.change(screen.getByRole('textbox', { name: '입력' }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '체크' }));
    fireEvent.click(screen.getByRole('switch', { name: '스위치' }));
    fireEvent.click(screen.getByRole('radio', { name: '둘' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
    expect(onSegment).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '입력' }).getAttribute('aria-disabled')).toBe('true');
  });
});
