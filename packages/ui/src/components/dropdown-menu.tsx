import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';
import { Kbd } from './kbd.js';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...rest
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(MATERIAL.popover, 'min-w-40 p-1 z-(--z-popover) animate-fade-in text-fg', className)}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  kbd?: readonly string[];
  danger?: boolean;
};

export function DropdownMenuItem({
  kbd,
  danger = false,
  className,
  children,
  ...rest
}: DropdownMenuItemProps): ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex h-(--row-h) items-center gap-2 rounded-inline px-2 text-sm text-fg data-highlighted:bg-state-hover data-disabled:opacity-50 data-disabled:cursor-not-allowed',
        danger && 'text-incorrect',
        className,
      )}
      {...rest}
    >
      {children}
      {kbd === undefined ? null : <Kbd keys={kbd} size="sm" className="ml-auto" />}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): ReactElement {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...rest} />;
}

export function DropdownMenuLabel({
  className,
  ...rest
}: ComponentProps<typeof DropdownMenuPrimitive.Label>): ReactElement {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1 text-xs text-fg-subtle', className)} {...rest} />;
}
