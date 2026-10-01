import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';

export const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-control transition-colors duration-(--dur-instant) ease-standard disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        ghost: 'bg-transparent text-fg hover:bg-state-hover',
        secondary: 'bg-surface-2 border border-border-input text-fg hover:bg-state-hover',
      },
      size: { sm: 'size-7', md: 'size-8' },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label' | 'children'> &
  VariantProps<typeof iconButtonVariants> & {
    'aria-label': string;
    icon: LucideIcon;
  };

export function IconButton({
  icon: Icon,
  variant,
  size,
  className,
  disabled,
  type,
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      type={type ?? 'button'}
      className={cn(iconButtonVariants({ variant, size }), className)}
      disabled={disabled}
      aria-disabled={disabled === true ? true : undefined}
      {...rest}
    >
      <Icon {...iconProps()} />
    </button>
  );
}
