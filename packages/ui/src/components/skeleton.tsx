import { type ReactElement, useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

export type SkeletonProps = {
  shape?: 'line' | 'block' | 'circle';
  delayMs?: number;
  className?: string;
};

const SHAPE = {
  line: 'h-3 rounded-inline',
  block: 'rounded-panel',
  circle: 'rounded-pill',
} as const;

export function Skeleton({ shape = 'line', delayMs = 300, className }: SkeletonProps): ReactElement | null {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) {
      setShown(true);
      return undefined;
    }
    setShown(false);
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  if (!shown) {
    return null;
  }
  return <div aria-hidden="true" data-shape={shape} className={cn('w-full bg-surface-3', SHAPE[shape], className)} />;
}
