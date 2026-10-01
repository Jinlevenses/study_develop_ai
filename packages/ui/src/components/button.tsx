import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { Kbd } from './kbd.js';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition-colors duration-(--dur-instant) ease-standard disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:opacity-90',
        secondary: 'bg-surface-2 border border-border-input text-fg hover:bg-state-hover',
        ghost: 'bg-transparent text-fg hover:bg-state-hover',
        danger: 'bg-danger text-on-danger hover:opacity-90',
        link: 'text-fg underline underline-offset-4 hover:bg-state-hover',
      },
      size: {
        sm: 'h-7 px-2 text-sm',
        md: 'h-(--control-h) px-(--control-px) text-sm',
        lg: 'h-11 px-5 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    kbd?: readonly string[];
    asChild?: boolean;
  };

export function Button({
  variant,
  size,
  loading = false,
  kbd,
  asChild = false,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps): ReactElement {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={isDisabled}
      aria-disabled={isDisabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? <LoaderCircle {...iconProps()} /> : null}
      {children}
      {kbd !== undefined && kbd.length > 0 ? <Kbd keys={kbd} size="sm" /> : null}
    </button>
  );
}
