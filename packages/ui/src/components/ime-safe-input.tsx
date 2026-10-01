import { type KeyboardEvent, type ReactElement, useRef } from 'react';
import { Input, type InputProps } from './input.js';

export function isImeComposing(e: { nativeEvent: { isComposing: boolean }; keyCode: number }): boolean {
  return e.nativeEvent.isComposing === true || e.keyCode === 229;
}

export type ImeSafeInputProps = InputProps & {
  onEnter?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

export function ImeSafeInput({
  onEnter,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: ImeSafeInputProps): ReactElement {
  const composing = useRef(false);
  return (
    <Input
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
        if (!e.defaultPrevented) {
          onEnter?.(e);
        }
      }}
    />
  );
}
