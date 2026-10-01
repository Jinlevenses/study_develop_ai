import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export type TextareaProps = ComponentProps<'textarea'> & {
  autoResize?: boolean;
  invalid?: boolean;
};

export function Textarea({
  autoResize = false,
  invalid = false,
  className,
  disabled,
  ...rest
}: TextareaProps): ReactElement {
  return (
    <textarea
      className={cn(
        MATERIAL.control,
        'px-(--control-px) py-2 text-base text-fg placeholder:text-fg-subtle aria-[invalid=true]:border-incorrect disabled:opacity-50 disabled:cursor-not-allowed',
        autoResize && 'field-sizing-content',
        className,
      )}
      disabled={disabled}
      aria-disabled={disabled === true ? true : undefined}
      aria-invalid={invalid ? true : undefined}
      {...rest}
    />
  );
}
