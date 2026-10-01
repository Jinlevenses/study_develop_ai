import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeRowWindow, type RowWindow, useWindowedRows } from '../../../src/hooks/use-windowed-rows.js';

afterEach(cleanup);

describe('computeRowWindow', () => {
  it('UT-UI-068 계산표와 경계·입력 위반(RangeError)을 검증한다 [FR-UX-007]', () => {
    expect(computeRowWindow({ count: 1000, rowHeight: 36, viewportHeight: 360, scrollTop: 3600, overscan: 6 })).toEqual(
      {
        start: 94,
        end: 116,
        offsetTop: 3384,
        totalHeight: 36000,
      },
    );
    expect(computeRowWindow({ count: 0, rowHeight: 36, viewportHeight: 360, scrollTop: 0, overscan: 6 })).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
    expect(
      computeRowWindow({ count: 1000, rowHeight: 36, viewportHeight: 360, scrollTop: 35640, overscan: 6 }).end,
    ).toBe(1000);
    const base = { count: 10, rowHeight: 36, viewportHeight: 100, scrollTop: 0, overscan: 2 };
    expect(() => computeRowWindow({ ...base, count: -1 })).toThrow(RangeError);
    expect(() => computeRowWindow({ ...base, count: 1.5 })).toThrow(RangeError);
    expect(() => computeRowWindow({ ...base, overscan: -1 })).toThrow(RangeError);
    expect(() => computeRowWindow({ ...base, rowHeight: 0 })).toThrow(RangeError);
    expect(() => computeRowWindow({ ...base, viewportHeight: -1 })).toThrow(RangeError);
    expect(() => computeRowWindow({ ...base, scrollTop: -1 })).toThrow(RangeError);
  });
});

function Probe(props: { show: boolean; onWindow: (w: RowWindow) => void }): React.ReactElement {
  const w = useWindowedRows({ count: 1000, rowHeight: 36 });
  props.onWindow({ start: w.start, end: w.end, offsetTop: w.offsetTop, totalHeight: w.totalHeight });
  return props.show ? <div data-testid="scroller" ref={w.containerRef} /> : <span />;
}

describe('useWindowedRows', () => {
  it('UT-UI-069 overscan 기본은 6이고 ref 해제·언마운트 시 scroll·resize 리스너를 제거한다 [FR-UX-007]', () => {
    const seen: RowWindow[] = [];
    const onWindow = (w: RowWindow): void => {
      seen.push(w);
    };
    const resizeRemove = vi.spyOn(window, 'removeEventListener');
    const { container, rerender, unmount } = render(<Probe show onWindow={onWindow} />);
    expect(seen.at(-1)).toEqual({ start: 0, end: 6, offsetTop: 0, totalHeight: 36000 });
    const el = container.querySelector('[data-testid="scroller"]') as HTMLElement;
    const elRemove = vi.spyOn(el, 'removeEventListener');
    Object.defineProperty(el, 'clientHeight', { value: 360, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 3600, configurable: true, writable: true });
    fireEvent.scroll(el);
    expect(seen.at(-1)).toMatchObject({ start: 94, end: 116 });
    act(() => {
      rerender(<Probe show={false} onWindow={onWindow} />);
    });
    expect(elRemove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(resizeRemove).toHaveBeenCalledWith('resize', expect.any(Function));
    const renders = seen.length;
    fireEvent.scroll(el);
    expect(seen.length).toBe(renders);
    unmount();
  });
});
