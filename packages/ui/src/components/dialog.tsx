import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';
import { IconButton } from './icon-button.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const SIZE = { sm: 'max-w-100', md: 'max-w-130', lg: 'max-w-180' } as const;

export type DialogContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title' | 'children'> & {
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  glass?: boolean;
  children?: ReactNode;
};

export function DialogContent({
  title,
  description,
  size = 'md',
  glass = false,
  children,
  className,
  ...rest
}: DialogContentProps): ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn('fixed inset-0 bg-scrim z-(--z-modal)', glass && 'glass backdrop-blur-glass')}
      />
      <DialogPrimitive.Content
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        {...rest}
        className={cn(
          MATERIAL.modal,
          'fixed inset-x-4 top-1/2 mx-auto max-h-full w-auto -translate-y-1/2 overflow-auto p-6 z-(--z-modal) animate-fade-in',
          SIZE[size],
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

export function DialogFooter({ className, ...rest }: ComponentProps<'div'>): ReactElement {
  return <div className={cn('mt-6 flex items-center justify-end gap-2', className)} {...rest} />;
}
