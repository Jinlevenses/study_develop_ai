import { type KeyboardEvent, type ReactElement, useRef } from 'react';
import { isImeComposing } from './ime-safe-input.js';
import { Textarea, type TextareaProps } from './textarea.js';

export type ImeSafeTextareaProps = TextareaProps & {
  onSubmitShortcut?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  submitOnEnter?: boolean;
  onEnter?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function ImeSafeTextarea({
  onSubmitShortcut,
  submitOnEnter = false,
  onEnter,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: ImeSafeTextareaProps): ReactElement {
  const composing = useRef(false);
  return (
    <Textarea
      {...rest}
      onCompositionStart={(e) => {
        composing.current = true;
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        onCompositionEnd?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') {
          onKeyDown?.(e);
          return;
        }
        if (isImeComposing(e) || composing.current) {
          e.preventDefault();
          return;
        }
        onKeyDown?.(e);
        if (e.defaultPrevented) {
          return;
        }
        if ((e.metaKey || e.ctrlKey) && onSubmitShortcut !== undefined) {
          e.preventDefault();
          onSubmitShortcut(e);
          return;
        }
        if (submitOnEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          onEnter?.(e);
        }
      }}
    />
  );
}
