import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert } from 'lucide-react';
import { type ComponentProps, type ReactElement, useId } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export const inputVariants = cva(
  `${MATERIAL.control} text-fg placeholder:text-fg-subtle aria-[invalid=true]:border-incorrect disabled:opacity-50 disabled:cursor-not-allowed`,
  {
    variants: {
      size: { sm: 'h-7 px-2 text-sm', md: 'h-(--control-h) px-(--control-px) text-base' },
    },
    defaultVariants: { size: 'md' },
  },
);

export type InputProps = Omit<ComponentProps<'input'>, 'size'> &
  VariantProps<typeof inputVariants> & {
    invalid?: boolean;
    errorMessage?: string;
  };

export function Input({
  size,
  invalid = false,
  errorMessage,
  className,
  disabled,
  'aria-describedby': describedBy,
  ...rest
}: InputProps): ReactElement {
  const messageId = useId();
  const hasMessage = errorMessage !== undefined && errorMessage !== '';
  const described = [describedBy, hasMessage ? messageId : undefined].filter(Boolean).join(' ');
  return (
    <>
      <input
        className={cn(inputVariants({ size }), className)}
        disabled={disabled}
        aria-disabled={disabled === true ? true : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={described === '' ? undefined : described}
        {...rest}
      />
      {hasMessage ? (
        <p id={messageId} className="mt-1 inline-flex items-center gap-1.5 text-xs text-incorrect">
          <CircleAlert {...iconProps()} />
          {errorMessage}
        </p>
      ) : null}
    </>
  );
}
