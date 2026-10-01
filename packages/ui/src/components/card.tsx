import type { LucideIcon } from 'lucide-react';
import { Check, CircleDashed, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { Panel, type PanelProps } from './panel.js';

export type CardVariant = 'default' | 'selected' | 'correct' | 'incorrect' | 'partial';

export type CardProps = PanelProps & {
  variant?: CardVariant;
  statusLabel?: string;
};

const VARIANT: Record<CardVariant, string> = {
  default: '',
  selected: 'border-border-strong bg-state-selected',
  correct: 'border-correct bg-correct-wash',
  incorrect: 'border-incorrect bg-incorrect-wash',
  partial: 'border-partial',
};

const STATUS: Partial<Record<CardVariant, { Icon: LucideIcon; tone: string; label: string }>> = {
  correct: { Icon: Check, tone: 'text-correct', label: '정답' },
  incorrect: { Icon: X, tone: 'text-incorrect', label: '오답' },
  partial: { Icon: CircleDashed, tone: 'text-partial', label: '부분 정답' },
};

export function Card({ variant = 'default', statusLabel, className, children, ...rest }: CardProps): ReactElement {
  const status = STATUS[variant];
  return (
    <Panel data-variant={variant} className={cn('relative overflow-hidden', VARIANT[variant], className)} {...rest}>
      {variant === 'partial' ? (
        <span
          aria-hidden="true"
          data-hatch=""
          className="absolute inset-y-0 left-0 w-1 text-partial"
          style={{ backgroundImage: 'var(--viz-hatch)' }}
        />
      ) : null}
      {status === undefined ? null : (
        <p className="mb-2 inline-flex items-center gap-1.5 text-sm text-fg">
          <span className={status.tone}>
            <status.Icon {...iconProps()} />
          </span>
          {statusLabel ?? status.label}
        </p>
      )}
      {children}
    </Panel>
  );
}
