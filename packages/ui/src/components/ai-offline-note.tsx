import { CloudOff } from 'lucide-react';
import type { ReactElement } from 'react';
import { iconProps } from '../lib/icon.js';

export type AiOfflineNoteProps = {
  variant?: 'compact' | 'block';
  href?: string;
};

export function AiOfflineNote({ variant = 'block', href = '/ai' }: AiOfflineNoteProps): ReactElement {
  const text = variant === 'compact' ? 'AI 없이 진행 중' : 'AI 없이 진행 중 — 판정은 잠정/자기채점입니다';
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
      <CloudOff {...iconProps()} />
      <span>{text}</span>
      <a href={href} className="text-fg underline underline-offset-4">
        AI 연결
      </a>
    </p>
  );
}
