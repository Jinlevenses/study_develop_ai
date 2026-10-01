import type { ReactElement } from 'react';
import { MATERIAL } from '../lib/materials.js';

export type TierTagProps = {
  tier: 'A' | 'B' | 'C';
  label?: string;
};

export function TierTag({ tier, label }: TierTagProps): ReactElement {
  return (
    <span data-tier={tier} className={`${MATERIAL.inline} inline-flex items-center px-1.5 text-2xs text-fg-muted`}>
      {label ?? `티어 ${tier}`}
    </span>
  );
}
