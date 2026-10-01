import { useCallback, useRef, useState } from 'react';

export type RowWindow = {
  readonly start: number;
  readonly end: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
};

export type RowWindowInput = {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
};

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** 고정 행 높이 창 계산(DN-D6). end는 배타. */
export function computeRowWindow(input: RowWindowInput): RowWindow {
  const { count, rowHeight, viewportHeight, scrollTop, overscan } = input;
  if (!isNonNegativeInt(count)) {
    throw new RangeError(`count는 0 이상 정수여야 한다: ${count}`);
  }
  if (!isNonNegativeInt(overscan)) {
    throw new RangeError(`overscan은 0 이상 정수여야 한다: ${overscan}`);
  }
  if (!(Number.isFinite(rowHeight) && rowHeight > 0)) {
    throw new RangeError(`rowHeight는 0보다 커야 한다: ${rowHeight}`);
  }
  if (!(Number.isFinite(viewportHeight) && viewportHeight >= 0)) {
    throw new RangeError(`viewportHeight는 0 이상이어야 한다: ${viewportHeight}`);
  }
  if (!(Number.isFinite(scrollTop) && scrollTop >= 0)) {
    throw new RangeError(`scrollTop은 0 이상이어야 한다: ${scrollTop}`);
  }
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.min(count, first) - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight: count * rowHeight };
}

type Metrics = { readonly viewportHeight: number; readonly scrollTop: number };
const ZERO: Metrics = { viewportHeight: 0, scrollTop: 0 };

export function useWindowedRows(opts: {
  count: number;
  rowHeight: number;
  overscan?: number;
}): RowWindow & { readonly containerRef: (el: HTMLElement | null) => void } {
  const [metrics, setMetrics] = useState<Metrics>(ZERO);
  const detach = useRef<(() => void) | null>(null);

  const containerRef = useCallback((el: HTMLElement | null): void => {
    detach.current?.();
    detach.current = null;
    if (el === null) {
      setMetrics(ZERO);
      return;
    }
    const read = (): void => {
      const next: Metrics = { viewportHeight: el.clientHeight, scrollTop: el.scrollTop };
      setMetrics((prev) =>
        prev.viewportHeight === next.viewportHeight && prev.scrollTop === next.scrollTop ? prev : next,
      );
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    detach.current = (): void => {
      el.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  const win = computeRowWindow({
    count: opts.count,
    rowHeight: opts.rowHeight,
    viewportHeight: metrics.viewportHeight,
    scrollTop: metrics.scrollTop,
    overscan: opts.overscan ?? 6,
  });
  return { ...win, containerRef };
}
