import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { type ReactElement, type RefObject, useRef, useState } from 'react';
import { MATERIAL } from '../lib/materials.js';
import { Button } from './button.js';
import { ImeSafeInput } from './ime-safe-input.js';

export type ConfirmByNameProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  name: string;
  confirmLabel: string;
  onConfirm: () => void;
};

type BodyProps = Pick<ConfirmByNameProps, 'name' | 'confirmLabel' | 'onConfirm' | 'onOpenChange'> & {
  inputRef: RefObject<HTMLInputElement | null>;
};

// 열릴 때마다 새로 마운트되므로 입력값이 자동으로 초기화된다.
function ConfirmBody({ name, confirmLabel, onConfirm, onOpenChange, inputRef }: BodyProps): ReactElement {
  const [text, setText] = useState('');
  const matched = text.normalize('NFC') === name.normalize('NFC');
  const confirm = (): void => {
    onConfirm();
    onOpenChange(false);
  };
  return (
    <>
      <p className="mt-4 text-sm text-fg">확인하려면 "{name}"을 입력하세요</p>
      <div className="mt-2">
        <ImeSafeInput
          ref={inputRef}
          aria-label="작업 이름 확인"
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onEnter={() => {
            if (matched) {
              confirm();
            }
          }}
        />
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <AlertDialogPrimitive.Cancel asChild>
          <Button variant="secondary">취소</Button>
        </AlertDialogPrimitive.Cancel>
        <Button variant="danger" disabled={!matched} onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}

export function ConfirmByName({
  open,
  onOpenChange,
  title,
  description,
  name,
  confirmLabel,
  onConfirm,
}: ConfirmByNameProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 bg-scrim z-(--z-modal)" />
        <AlertDialogPrimitive.Content
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={`${MATERIAL.modal} fixed inset-x-4 top-1/2 mx-auto max-w-130 -translate-y-1/2 p-6 z-(--z-modal) animate-fade-in`}
        >
          <AlertDialogPrimitive.Title className="text-lg text-fg">{title}</AlertDialogPrimitive.Title>
          {description === undefined ? null : (
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-fg-muted">
              {description}
            </AlertDialogPrimitive.Description>
          )}
          <ConfirmBody
            name={name}
            confirmLabel={confirmLabel}
            onConfirm={onConfirm}
            onOpenChange={onOpenChange}
            inputRef={inputRef}
          />
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
