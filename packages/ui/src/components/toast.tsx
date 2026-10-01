import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { Toaster as Sonner, toast } from 'sonner';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type ToastType = 'info' | 'success' | 'warn' | 'error';

export function Toaster(): ReactElement {
  return (
    <Sonner
      position="bottom-right"
      visibleToasts={3}
      richColors={false}
      closeButton={false}
      style={{ zIndex: 'var(--z-toast)' }}
      icons={{
        success: (
          <span className="text-correct">
            <Check {...iconProps()} />
          </span>
        ),
        info: (
          <span className="text-fg-muted">
            <Info {...iconProps()} />
          </span>
        ),
        warning: (
          <span className="text-due">
            <TriangleAlert {...iconProps()} />
          </span>
        ),
        error: (
          <span className="text-incorrect">
            <CircleAlert {...iconProps()} />
          </span>
        ),
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: '닫기',
        classNames: {
          toast: `${MATERIAL.popover} flex w-90 items-start gap-3 p-3 text-sm text-fg`,
          title: 'text-sm text-fg',
          description: 'text-xs text-fg-muted',
          actionButton: 'ml-auto h-7 rounded-control border border-border-input bg-surface-2 px-2 text-sm text-fg',
          closeButton: 'rounded-inline border border-border-input bg-surface-2 text-fg',
        },
      }}
    />
  );
}

export type ShowToastInput = {
  type: ToastType;
  title: string;
  description?: string;
  action?: { label: string; onSelect: () => void };
};

export function showToast(input: ShowToastInput): string | number {
  const options = {
    description: input.description,
    action: input.action === undefined ? undefined : { label: input.action.label, onClick: input.action.onSelect },
    duration: input.type === 'error' ? Number.POSITIVE_INFINITY : 4000,
    closeButton: input.type === 'error' ? true : undefined,
  };
  switch (input.type) {
    case 'success':
      return toast.success(input.title, options);
    case 'info':
      return toast.info(input.title, options);
    case 'warn':
      return toast.warning(input.title, options);
    case 'error':
      return toast.error(input.title, options);
  }
}
