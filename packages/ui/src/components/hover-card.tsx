import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export const HOVER_CARD_DELAY = { open: 400, close: 150 } as const;

export const HoverCardTrigger = HoverCardPrimitive.Trigger;

export function HoverCard({
  openDelay = HOVER_CARD_DELAY.open,
  closeDelay = HOVER_CARD_DELAY.close,
  ...rest
}: ComponentProps<typeof HoverCardPrimitive.Root>): ReactElement {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...rest} />;
}

export function HoverCardContent({
  className,
  sideOffset = 6,
  ...rest
}: ComponentProps<typeof HoverCardPrimitive.Content>): ReactElement {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={sideOffset}
        className={cn(MATERIAL.popover, 'p-3 z-(--z-popover) animate-fade-in text-fg', className)}
        {...rest}
      />
    </HoverCardPrimitive.Portal>
  );
}
