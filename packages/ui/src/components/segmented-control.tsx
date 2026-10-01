import type { LucideIcon } from 'lucide-react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';

export type SegmentedOption = { value: string; label: string; icon?: LucideIcon };

export type SegmentedControlProps = {
  options: readonly SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string;
  disabled?: boolean;
  className?: string;
};

const SIZE = {
  sm: 'h-7 px-2 text-sm',
  md: 'h-(--control-h) px-(--control-px) text-sm',
  lg: 'h-11 px-5 text-base',
} as const;

export function SegmentedControl({
  options,
  value,
  onValueChange,
  size = 'md',
  'aria-label': ariaLabel,
  disabled,
  className,
}: SegmentedControlProps): ReactElement {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next !== '') {
          onValueChange(next);
        }
      }}
      role="group"
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control border border-border-input bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          aria-disabled={disabled === true ? true : undefined}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-inline font-medium text-fg-muted transition-colors duration-(--dur-instant) ease-standard hover:bg-state-hover data-[state=on]:bg-surface-3 data-[state=on]:text-fg disabled:opacity-50 disabled:cursor-not-allowed',
            SIZE[size],
          )}
        >
          {o.icon !== undefined ? <o.icon {...iconProps()} /> : null}
          {o.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
