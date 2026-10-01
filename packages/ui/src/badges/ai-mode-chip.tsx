import { CircleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type AiModeValue = 'FULL' | 'JUDGE_ONLY' | 'LLM_ONLY' | 'OFFLINE';

export type AiModeChipProps = {
  mode: AiModeValue;
  degraded?: boolean;
  label?: string;
};

const SPEC = {
  FULL: { label: 'AI: 전체', dot: 'text-correct' },
  JUDGE_ONLY: { label: 'AI: 판단만', dot: 'text-due' },
  LLM_ONLY: { label: 'AI: 생성만', dot: 'text-due' },
  OFFLINE: { label: 'AI: 오프라인', dot: 'text-fg-subtle' },
} as const;

export function AiModeChip({ mode, degraded = false, label }: AiModeChipProps): ReactElement {
  const spec = SPEC[mode];
  return (
    <span
      data-mode={mode}
      className={cn(
        MATERIAL.inline,
        'inline-flex items-center gap-1 px-1.5 text-2xs text-fg',
        degraded && 'border-dashed',
      )}
    >
      <span aria-hidden="true" data-dot="" className={spec.dot}>
        ●
      </span>
      {`${label ?? spec.label}${degraded ? ' · 격하' : ''}`}
      {degraded ? <CircleAlert {...iconProps()} /> : null}
    </span>
  );
}
