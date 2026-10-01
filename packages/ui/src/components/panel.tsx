import { type ComponentProps, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export type PanelProps = Omit<ComponentProps<'section'>, 'children' | 'ref'> & {
  heading?: string;
  headingLevel?: 2 | 3 | 4;
  as?: 'section' | 'div';
  material?: 'panel' | 'popover';
  children?: ReactNode;
};

const HEADING = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export function Panel({
  heading,
  headingLevel = 2,
  as = 'section',
  material = 'panel',
  children,
  className,
  ...rest
}: PanelProps): ReactElement {
  const id = useId();
  const Tag = as;
  const Heading = HEADING[headingLevel];
  return (
    <Tag
      aria-labelledby={heading === undefined ? undefined : id}
      className={cn(MATERIAL[material], 'p-(--panel-p) text-fg', className)}
      {...rest}
    >
      {heading === undefined ? null : (
        <Heading id={id} className="mb-3 text-lg text-fg">
          {heading}
        </Heading>
      )}
      {children}
    </Tag>
  );
}
