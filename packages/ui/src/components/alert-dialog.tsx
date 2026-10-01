import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { MATERIAL } from '../lib/materials.js';
import { Button } from './button.js';

export type AlertDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
};

export function AlertDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = '취소',
  onConfirm,
  danger = false,
}: AlertDialogProps): ReactElement {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger === undefined ? null : <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 bg-scrim z-(--z-modal)" />
        <AlertDialogPrimitive.Content
          className={`${MATERIAL.modal} fixed inset-x-4 top-1/2 mx-auto max-w-100 -translate-y-1/2 p-6 z-(--z-modal) animate-fade-in`}
        >
          <AlertDialogPrimitive.Title className="text-lg text-fg">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-sm text-fg-muted">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="mt-6 flex items-center justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
