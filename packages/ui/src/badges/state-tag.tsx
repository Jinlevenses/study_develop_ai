import type { LucideIcon } from 'lucide-react';
import { Ban, Check, CircleDashed, Clock, Hourglass, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type StateTagState = 'correct' | 'partial' | 'incorrect' | 'pending' | 'provisional' | 'voided';

export type StateTagProps = {
  state: StateTagState;
  label?: string;
};

type Spec = { Icon: LucideIcon; text: string; tone: string; extra: string };

const SPEC: Record<StateTagState, Spec> = {
  correct: { Icon: Check, text: '정답', tone: 'text-correct', extra: '' },
  partial: { Icon: CircleDashed, text: '부분 정답', tone: 'text-partial', extra: 'relative overflow-hidden' },
  incorrect: { Icon: X, text: '오답', tone: 'text-incorrect', extra: '' },
  pending: { Icon: Hourglass, text: '채점 대기', tone: 'text-fg-muted', extra: 'border-dashed border-border-strong' },
  provisional: { Icon: Clock, text: '잠정', tone: 'text-fg-muted', extra: 'border-dashed' },
  voided: { Icon: Ban, text: '무효', tone: 'text-fg-muted', extra: '' },
};

export function StateTag({ state, label }: StateTagProps): ReactElement {
  const { Icon, text, tone, extra } = SPEC[state];
  return (
    <span
      data-state={state}
      className={cn(MATERIAL.inline, 'inline-flex items-center gap-1 px-1.5 text-2xs text-fg', extra)}
    >
      <span className={tone}>
        <Icon {...iconProps()} />
      </span>
      <span className={state === 'voided' ? 'line-through' : undefined}>{label ?? text}</span>
      {state === 'partial' ? (
        <span
          aria-hidden="true"
          data-hatch=""
          className="absolute inset-x-0 bottom-0 h-0.5 text-partial"
          style={{ backgroundImage: 'var(--viz-hatch)' }}
        />
      ) : null}
    </span>
  );
}
