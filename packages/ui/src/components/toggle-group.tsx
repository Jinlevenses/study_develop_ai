import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';

export type TogglePattern = 'solid' | 'dotted' | 'dashed' | 'double' | 'hatch';
export type ToggleOption = { value: string; label: string; pattern?: TogglePattern };

export type ToggleGroupProps = {
  options: readonly ToggleOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
};

const PATTERN_CLASS = {
  solid: 'border-solid',
  dotted: 'border-dotted',
  dashed: 'border-dashed',
  double: 'border-double',
  hatch: 'border-solid',
} as const;

export function ToggleGroup({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  disabled,
  className,
}: ToggleGroupProps): ReactElement {
  return (
    <ToggleGroupPrimitive.Root
      type="multiple"
      value={[...value]}
      onValueChange={onValueChange}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn('inline-flex flex-wrap items-center gap-1', className)}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          aria-disabled={disabled === true ? true : undefined}
          className="inline-flex h-7 items-center gap-1.5 rounded-control border border-border-input bg-surface-2 px-2 text-sm text-fg-muted transition-colors duration-(--dur-instant) ease-standard hover:bg-state-hover data-[state=on]:bg-surface-3 data-[state=on]:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {o.pattern !== undefined ? (
            <span
              aria-hidden="true"
              data-pattern={o.pattern}
              className={cn('inline-block h-3 w-5 border-2 border-fg text-fg', PATTERN_CLASS[o.pattern])}
              style={o.pattern === 'hatch' ? { backgroundImage: 'var(--viz-hatch)' } : undefined}
            />
          ) : null}
          {o.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
