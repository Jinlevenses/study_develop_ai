import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';
import { isImeComposing } from './ime-safe-input.js';
import { Kbd } from './kbd.js';

export type CommandProps = Omit<ComponentProps<typeof CommandPrimitive>, 'label' | 'filter'> & {
  label: string;
  variant?: 'palette' | 'inline';
  filter?: (value: string, search: string, keywords?: string[]) => number;
  shouldFilter?: boolean;
};

export function Command({
  label,
  variant = 'inline',
  filter,
  shouldFilter,
  className,
  onKeyDown,
  ...rest
}: CommandProps): ReactElement {
  return (
    <CommandPrimitive
      label={label}
      filter={filter}
      shouldFilter={shouldFilter}
      className={cn(
        variant === 'palette' ? MATERIAL.modal : MATERIAL.panel,
        'flex w-full flex-col overflow-hidden text-fg',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isImeComposing(e)) {
          e.preventDefault();
          return;
        }
        onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}

export function CommandInput({ className, ...rest }: ComponentProps<typeof CommandPrimitive.Input>): ReactElement {
  return (
    <CommandPrimitive.Input
      className={cn(
        'h-(--control-h) w-full border-b border-border bg-transparent px-(--control-px) text-base text-fg placeholder:text-fg-subtle',
        className,
      )}
      {...rest}
    />
  );
}

export function CommandList({ className, ...rest }: ComponentProps<typeof CommandPrimitive.List>): ReactElement {
  return <CommandPrimitive.List className={cn('overflow-y-auto p-1', className)} {...rest} />;
}

export function CommandEmpty({
  children = '결과가 없습니다',
  className,
  ...rest
}: ComponentProps<typeof CommandPrimitive.Empty>): ReactElement {
  return (
    <CommandPrimitive.Empty className={cn('px-3 py-6 text-center text-sm text-fg-muted', className)} {...rest}>
      {children}
    </CommandPrimitive.Empty>
  );
}

export function CommandGroup({ className, ...rest }: ComponentProps<typeof CommandPrimitive.Group>): ReactElement {
  return <CommandPrimitive.Group className={cn('text-xs text-fg-subtle', className)} {...rest} />;
}

export type CommandItemProps = ComponentProps<typeof CommandPrimitive.Item> & { kbd?: readonly string[] };

export function CommandItem({ kbd, className, children, ...rest }: CommandItemProps): ReactElement {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex h-(--row-h) items-center gap-2 rounded-inline px-2 text-sm text-fg data-[selected=true]:bg-state-hover data-[disabled=true]:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
      {kbd === undefined ? null : <Kbd keys={kbd} size="sm" className="ml-auto" />}
    </CommandPrimitive.Item>
  );
}

export function CommandSeparator({
  className,
  ...rest
}: ComponentProps<typeof CommandPrimitive.Separator>): ReactElement {
  return <CommandPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...rest} />;
}
