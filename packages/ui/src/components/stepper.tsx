import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';

export type StepState = 'done' | 'current' | 'todo';
export type StepperStep = { id: string; label: string; state: StepState };

export type StepperProps = {
  variant: 'pipeline' | 'wizard';
  'aria-label': string;
  steps: readonly StepperStep[];
};

export function Stepper({ variant, 'aria-label': ariaLabel, steps }: StepperProps): ReactElement {
  return (
    <ol
      aria-label={ariaLabel}
      data-variant={variant}
      className={cn('flex gap-2 text-sm', variant === 'pipeline' ? 'flex-row flex-wrap items-center' : 'flex-col')}
    >
      {steps.map((s, i) => (
        <li
          key={s.id}
          data-state={s.state}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-inline px-2 py-1',
            s.state === 'current' ? 'bg-surface-3 font-medium text-fg' : 'text-fg-muted',
          )}
        >
          {s.state === 'done' ? (
            <>
              <Check {...iconProps()} />
              <span className="sr-only">완료</span>
            </>
          ) : null}
          <span className="num">{i + 1}.</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
