import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';

export type ProgressProps = {
  label: string;
  value: number;
  max?: number;
  variant?: 'bar' | 'steps';
  steps?: number;
  thickness?: 'thin' | 'thick';
  tone?: 'session' | 'task';
  className?: string;
};

const THICKNESS = { thin: 'h-px', thick: 'h-1' } as const;
const TONE = { session: 'bg-depth-3', task: 'bg-fg-muted' } as const;

export function Progress({
  label,
  value,
  max = 100,
  variant = 'bar',
  steps = 5,
  thickness = 'thick',
  tone = 'task',
  className,
}: ProgressProps): ReactElement {
  const now = Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? now / max : 0;
  const pct = ratio * 100;
  const filled = Math.round(ratio * steps);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      data-variant={variant}
      className={cn('w-full', className)}
    >
      {variant === 'bar' ? (
        <div className={cn('w-full overflow-hidden rounded-pill bg-surface-3', THICKNESS[thickness])}>
          <div className={cn('h-full rounded-pill', TONE[tone])} style={{ inlineSize: `${pct}%` }} />
        </div>
      ) : (
        <div className="flex w-full gap-0.5">
          {Array.from({ length: steps }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 고정 길이 칸 목록이라 순서가 곧 정체성이다
              key={i}
              data-filled={i < filled ? 'true' : 'false'}
              className={cn('flex-1 rounded-pill', THICKNESS[thickness], i < filled ? TONE[tone] : 'bg-surface-3')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
