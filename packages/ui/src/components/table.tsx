import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';

export type TableProps = ComponentProps<'table'> & {
  wrapperProps?: ComponentProps<'div'> & { 'data-windowed'?: string };
};

export function Table({ className, wrapperProps, ...rest }: TableProps): ReactElement {
  return (
    <div {...wrapperProps} className={cn('overflow-auto', wrapperProps?.className)}>
      <table className={cn('w-full text-sm text-fg', className)} {...rest} />
    </div>
  );
}

export function TableCaption({ className, ...rest }: ComponentProps<'caption'>): ReactElement {
  return <caption className={cn('py-2 text-left text-xs text-fg-muted', className)} {...rest} />;
}

export function TableHeader({ className, ...rest }: ComponentProps<'thead'>): ReactElement {
  return <thead className={cn('sticky top-0 z-(--z-sticky) bg-surface-1', className)} {...rest} />;
}

export function TableBody(props: ComponentProps<'tbody'>): ReactElement {
  return <tbody {...props} />;
}

export function TableRow({ className, ...rest }: ComponentProps<'tr'>): ReactElement {
  return <tr className={cn('h-(--row-h) border-b border-border', className)} {...rest} />;
}

export type TableHeadProps = ComponentProps<'th'> & { numeric?: boolean };

export function TableHead({ numeric = false, scope = 'col', className, ...rest }: TableHeadProps): ReactElement {
  return (
    <th
      scope={scope}
      data-numeric={numeric ? '' : undefined}
      className={cn(
        'sticky top-0 z-(--z-sticky) bg-surface-1 px-3 text-left text-xs font-medium text-fg-muted',
        numeric && 'num text-right',
        className,
      )}
      {...rest}
    />
  );
}

export type TableCellProps = ComponentProps<'td'> & { numeric?: boolean };

export function TableCell({ numeric = false, className, ...rest }: TableCellProps): ReactElement {
  return (
    <td
      data-numeric={numeric ? '' : undefined}
      className={cn('px-3', numeric && 'num text-right', className)}
      {...rest}
    />
  );
}
