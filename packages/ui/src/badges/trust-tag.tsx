import type { ReactElement } from 'react';
import { MATERIAL } from '../lib/materials.js';

export type TrustValue = 'seed' | 'verified' | 'user' | 'llm_unverified';

export type TrustTagProps = {
  trust: TrustValue;
  label?: string;
};

const TEXT = { seed: '시드', verified: '검증됨', user: '사용자', llm_unverified: 'LLM 미검증' } as const;

export function TrustTag({ trust, label }: TrustTagProps): ReactElement {
  return (
    <span data-trust={trust} className={`${MATERIAL.inline} inline-flex items-center px-1.5 text-2xs text-fg-muted`}>
      {label ?? TEXT[trust]}
    </span>
  );
}
