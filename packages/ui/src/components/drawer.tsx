import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';
import { IconButton } from './icon-button.js';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const SIDE = {
  right: 'right-0 w-100 rounded-l-popover border-l',
  left: 'left-0 w-90 rounded-r-popover border-r',
} as const;

export type DrawerContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title' | 'children'> & {
  side?: 'right' | 'left';
  title: string;
  description?: string;
  children?: ReactNode;
};

export function DrawerContent({
  side = 'right',
  title,
  description,
  children,
  className,
  ...rest
}: DrawerContentProps): ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-scrim z-(--z-drawer)" />
      <DialogPrimitive.Content
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        {...rest}
        className={cn(
          MATERIAL.drawer,
          'fixed inset-y-0 max-w-full overflow-y-auto p-6 z-(--z-drawer) animate-panel-in',
          SIDE[side],
          className,
        )}
      >
        <DialogPrimitive.Title className="pr-8 text-lg text-fg">{title}</DialogPrimitive.Title>
        {description === undefined ? null : (
          <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">
            {description}
          </DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close asChild>
          <IconButton aria-label="닫기" icon={X} size="sm" className="absolute right-3 top-3" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
