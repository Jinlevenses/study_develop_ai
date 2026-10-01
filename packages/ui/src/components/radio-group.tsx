import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { type ReactElement, useId } from 'react';
import { cn } from '../lib/cn.js';

export type RadioOption = { value: string; label: string; description?: string; disabled?: boolean };

export type RadioGroupProps = {
  options: readonly RadioOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  'aria-label': string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

export function RadioGroup({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  orientation = 'vertical',
  className,
}: RadioGroupProps): ReactElement {
  const base = useId();
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      aria-label={ariaLabel}
      orientation={orientation}
      className={cn('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-4', className)}
    >
      {options.map((o, i) => {
        const id = `${base}-${i}`;
        return (
          <div key={o.value} className="flex min-h-6 items-start gap-2">
            <RadioGroupPrimitive.Item
              id={id}
              value={o.value}
              disabled={o.disabled}
              aria-disabled={o.disabled === true ? true : undefined}
              className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-pill border border-border-input bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RadioGroupPrimitive.Indicator className="block size-2 rounded-pill bg-fg" />
            </RadioGroupPrimitive.Item>
            <label
              htmlFor={id}
              className={cn('flex flex-col text-sm text-fg', o.disabled === true && 'opacity-50 cursor-not-allowed')}
            >
              {o.label}
              {o.description !== undefined ? <span className="text-xs text-fg-muted">{o.description}</span> : null}
            </label>
          </div>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
