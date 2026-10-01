import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';
import { Kbd } from './kbd.js';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...rest
}: ComponentProps<typeof ContextMenuPrimitive.Content>): ReactElement {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(MATERIAL.popover, 'min-w-40 p-1 z-(--z-popover) animate-fade-in text-fg', className)}
        {...rest}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export type ContextMenuItemProps = ComponentProps<typeof ContextMenuPrimitive.Item> & {
  kbd?: readonly string[];
  danger?: boolean;
};

export function ContextMenuItem({
  kbd,
  danger = false,
  className,
  children,
  ...rest
}: ContextMenuItemProps): ReactElement {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'flex h-(--row-h) items-center gap-2 rounded-inline px-2 text-sm text-fg data-highlighted:bg-state-hover data-disabled:opacity-50 data-disabled:cursor-not-allowed',
        danger && 'text-incorrect',
        className,
      )}
      {...rest}
    >
      {children}
      {kbd === undefined ? null : <Kbd keys={kbd} size="sm" className="ml-auto" />}
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator({
  className,
  ...rest
}: ComponentProps<typeof ContextMenuPrimitive.Separator>): ReactElement {
  return <ContextMenuPrimitive.Separator className={cn('my-1 h-px bg-border', className)} {...rest} />;
}
