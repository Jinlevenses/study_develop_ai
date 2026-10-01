import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  sideOffset = 6,
  ...rest
}: ComponentProps<typeof PopoverPrimitive.Content>): ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn(MATERIAL.popover, 'p-3 z-(--z-popover) animate-fade-in text-fg', className)}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
}
