import type { ReactElement } from 'react';
import { Tooltip } from '../components/tooltip.js';
import { cn } from '../lib/cn.js';

export type LevelBadgeProps = {
  level: 1 | 2 | 3 | 4 | 5;
  size?: 'sm' | 'md';
  provisional?: boolean;
  label?: string;
};

const DEPTH_BG = { 1: 'bg-depth-1', 2: 'bg-depth-2', 3: 'bg-depth-3', 4: 'bg-depth-4', 5: 'bg-depth-5' } as const;
const SIZE = { sm: 'h-4 px-1.5', md: 'h-5 px-2' } as const;

export function LevelBadge({ level, size = 'md', provisional = false, label }: LevelBadgeProps): ReactElement {
  const badge = (
    <span
      role="img"
      aria-label={provisional ? `레벨 ${level} (잠정)` : `레벨 ${level}`}
      tabIndex={provisional ? 0 : undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-pill text-2xs font-semibold text-on-depth',
        DEPTH_BG[level],
        SIZE[size],
        provisional && 'border border-dashed border-fg',
      )}
    >
      {label ?? `L${level}`}
    </span>
  );
  return provisional ? <Tooltip content="잠정">{badge}</Tooltip> : badge;
}
