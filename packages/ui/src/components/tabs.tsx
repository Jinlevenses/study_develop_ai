import { Tabs as TabsPrimitive } from 'radix-ui';
import { type KeyboardEvent, type ReactElement, type ReactNode, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { isImeComposing } from './ime-safe-input.js';

export type TabItem = { value: string; label: string; content: ReactNode; disabled?: boolean };

export type TabsProps = {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'underline' | 'pill';
  numberKeys?: boolean;
  'aria-label': string;
  className?: string;
};

const TRIGGER = {
  underline:
    'h-(--control-h) px-3 text-sm text-fg-muted border-b-2 border-transparent data-[state=active]:border-b-2 data-[state=active]:border-fg data-[state=active]:text-fg',
  pill: 'h-7 rounded-inline px-3 text-sm text-fg-muted data-[state=active]:bg-surface-3 data-[state=active]:text-fg',
} as const;

const DIGIT = /^Digit([1-9])$/;

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = 'underline',
  numberKeys = false,
  'aria-label': ariaLabel,
  className,
}: TabsProps): ReactElement {
  const [inner, setInner] = useState<string | undefined>(defaultValue ?? items[0]?.value);
  const listRef = useRef<HTMLDivElement>(null);
  const current = value ?? inner;

  const select = (next: string): void => {
    setInner(next);
    onValueChange?.(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!numberKeys || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isImeComposing(e)) {
      return;
    }
    const m = DIGIT.exec(e.code);
    const n = m?.[1] === undefined ? 0 : Number(m[1]);
    const item = n === 0 ? undefined : items[n - 1];
    if (item === undefined || item.disabled === true) {
      return;
    }
    e.preventDefault();
    select(item.value);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[n - 1]?.focus();
  };

  return (
    <TabsPrimitive.Root value={current} onValueChange={select} activationMode="manual" className={className}>
      <TabsPrimitive.List
        ref={listRef}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn('flex items-center gap-1', variant === 'underline' && 'border-b border-border')}
      >
        {items.map((it) => (
          <TabsPrimitive.Trigger
            key={it.value}
            value={it.value}
            disabled={it.disabled}
            aria-disabled={it.disabled === true ? true : undefined}
            className={cn(
              'inline-flex items-center justify-center transition-colors duration-(--dur-instant) ease-standard hover:bg-state-hover disabled:opacity-50 disabled:cursor-not-allowed',
              TRIGGER[variant],
            )}
          >
            {it.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((it) => (
        <TabsPrimitive.Content key={it.value} value={it.value} className="pt-3">
          {it.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
