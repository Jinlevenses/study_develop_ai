import type { LucideIcon } from 'lucide-react';
import {
  WandSparkles as AiEstimateMark,
  Sparkles as AiMark,
  CircleHelp,
  Gauge,
  Hourglass,
  ListChecks,
  UserCheck,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type JudgeBadgeValue =
  | 'none'
  | 'ai'
  | 'ai_uncalibrated'
  | 'ai_confirm'
  | 'ai_estimate_confirm'
  | 'heuristic'
  | 'self'
  | 'pending';

export type JudgeBadgeProps = {
  badge: JudgeBadgeValue;
  label?: string;
};

type Mark = { id: string; Icon: LucideIcon };
type Spec = { label: string; icons: readonly Mark[]; border: string };

const SPARK: Mark = { id: 'ai', Icon: AiMark };
const ESTIMATE: Mark = { id: 'estimate', Icon: AiEstimateMark };
const GAUGE: Mark = { id: 'gauge', Icon: Gauge };
const HELP: Mark = { id: 'help', Icon: CircleHelp };

// SCR-01 §2.8 — 색 없이 아이콘·라벨·테두리 패턴으로만 구분한다.
const SPEC: Record<Exclude<JudgeBadgeValue, 'none'>, Spec> = {
  ai: { label: 'AI 채점', icons: [SPARK], border: 'border-solid' },
  ai_uncalibrated: { label: 'AI 채점 · 보정 전', icons: [SPARK, GAUGE], border: 'border-dotted' },
  ai_confirm: { label: 'AI 채점 · 확인 필요', icons: [SPARK, HELP], border: 'border-double border-2' },
  ai_estimate_confirm: {
    label: 'AI 추정 · 확인 필요',
    icons: [ESTIMATE, HELP],
    border: 'border-double border-2',
  },
  heuristic: { label: '간이 채점', icons: [{ id: 'list', Icon: ListChecks }], border: 'border-dotted' },
  self: { label: '자기평가', icons: [{ id: 'user', Icon: UserCheck }], border: 'border-solid' },
  pending: { label: '채점 대기', icons: [{ id: 'wait', Icon: Hourglass }], border: 'border-dashed' },
};

export function JudgeBadge({ badge, label }: JudgeBadgeProps): ReactElement | null {
  if (badge === 'none') {
    return null;
  }
  const spec = SPEC[badge];
  return (
    <span
      data-badge={badge}
      className={cn(
        MATERIAL.inline,
        'inline-flex items-center gap-1 px-1.5 text-2xs bg-surface-2 text-fg border-border-strong',
        spec.border,
      )}
    >
      {spec.icons.map((m) => (
        <m.Icon key={m.id} {...iconProps()} />
      ))}
      {label ?? spec.label}
    </span>
  );
}
