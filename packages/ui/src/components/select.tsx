import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  'aria-label': string;
  defaultOpen?: boolean;
  disabled?: boolean;
  className?: string;
};

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  size = 'md',
  'aria-label': ariaLabel,
  defaultOpen,
  disabled,
  className,
}: SelectProps): ReactElement {
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      defaultOpen={defaultOpen}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        aria-disabled={disabled === true ? true : undefined}
        className={cn(
          MATERIAL.control,
          'inline-flex items-center justify-between gap-2 text-fg disabled:opacity-50 disabled:cursor-not-allowed data-placeholder:text-fg-subtle',
          size === 'sm' ? 'h-7 px-2 text-sm' : 'h-(--control-h) px-(--control-px) text-base',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown {...iconProps()} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(MATERIAL.popover, 'z-(--z-popover) min-w-(--radix-select-trigger-width) p-1 text-fg')}
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex h-(--row-h) items-center justify-between gap-2 rounded-inline px-2 text-sm data-highlighted:bg-state-hover data-disabled:opacity-50 data-disabled:cursor-not-allowed"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check {...iconProps()} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
