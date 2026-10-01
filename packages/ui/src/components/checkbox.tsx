import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { type ReactElement, useId } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';

export type CheckboxProps = {
  label: string;
  checked: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function Checkbox({ label, checked, onCheckedChange, disabled, id, className }: CheckboxProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex min-h-6 items-center gap-2', className)}>
      <CheckboxPrimitive.Root
        id={inputId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-disabled={disabled === true ? true : undefined}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-inline border border-border-input bg-surface-2 data-[state=checked]:bg-fg data-[state=checked]:text-bg data-[state=indeterminate]:bg-fg data-[state=indeterminate]:text-bg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CheckboxPrimitive.Indicator>
          {checked === 'indeterminate' ? <Minus {...iconProps()} /> : <Check {...iconProps()} />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={inputId} className={cn('text-sm text-fg', disabled === true && 'opacity-50 cursor-not-allowed')}>
        {label}
      </label>
    </div>
  );
}
