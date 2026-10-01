import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export type DataClassValue = 'C0' | 'C1' | 'C2' | 'C3';

export type DataClassTagProps = {
  dataClass: DataClassValue;
  label?: string;
};

export function DataClassTag({ dataClass, label }: DataClassTagProps): ReactElement {
  return (
    <span
      data-class={dataClass}
      className={cn(
        MATERIAL.inline,
        'inline-flex items-center px-1.5 text-2xs text-fg-muted',
        dataClass === 'C3' && 'font-bold',
      )}
    >
      {label ?? dataClass}
    </span>
  );
}
