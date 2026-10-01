import { Switch as SwitchPrimitive } from 'radix-ui';
import { type ReactElement, useId } from 'react';
import { cn } from '../lib/cn.js';

export type SwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function Switch({ label, checked, onCheckedChange, disabled, id, className }: SwitchProps): ReactElement {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex min-h-6 items-center gap-2', className)}>
      <SwitchPrimitive.Root
        id={inputId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-disabled={disabled === true ? true : undefined}
        className="inline-flex h-5 w-10 shrink-0 items-center rounded-pill border border-border-input bg-surface-2 px-0.5 transition-colors duration-(--dur-fast) ease-standard data-[state=checked]:bg-fg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <SwitchPrimitive.Thumb className="block size-4 rounded-pill bg-fg-muted transition-transform duration-(--dur-fast) ease-standard data-[state=checked]:translate-x-4 data-[state=checked]:bg-bg" />
      </SwitchPrimitive.Root>
      <label htmlFor={inputId} className={cn('text-sm text-fg', disabled === true && 'opacity-50 cursor-not-allowed')}>
        {label}
      </label>
    </div>
  );
}
