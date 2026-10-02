import { AiModeChip } from '@fathom/ui/badges/ai-mode-chip';
import { DataClassTag } from '@fathom/ui/badges/data-class-tag';
import { JudgeBadge, type JudgeBadgeValue } from '@fathom/ui/badges/judge-badge';
import { LevelBadge } from '@fathom/ui/badges/level-badge';
import { StateTag, type StateTagState } from '@fathom/ui/badges/state-tag';
import { StatusDot, type StatusDotState } from '@fathom/ui/badges/status-dot';
import { TierTag } from '@fathom/ui/badges/tier-tag';
import { TrustTag } from '@fathom/ui/badges/trust-tag';
import type { ReactElement, ReactNode } from 'react';

const JUDGE: readonly JudgeBadgeValue[] = [
  'none',
  'ai',
  'ai_uncalibrated',
  'ai_confirm',
  'ai_estimate_confirm',
  'heuristic',
  'self',
  'pending',
];
const STATES: readonly StateTagState[] = ['correct', 'partial', 'incorrect', 'pending', 'provisional', 'voided'];
const DOTS: readonly StatusDotState[] = ['ready', 'ok', 'restarting', 'degraded', 'warn', 'fail', 'stopped', 'skip'];

function Row({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-sm text-fg-muted">{title}</span>
      {children}
    </div>
  );
}

/** 배지 전 값 견본(DS-01 §9) — 판정·레벨·AI 모드·상태·점·티어·신뢰·데이터 등급. */
export function BadgeSection(): ReactElement {
  return (
    <section aria-labelledby="ds-badges" className="flex flex-col gap-3">
      <h2 id="ds-badges" className="text-lg text-fg">
        배지
      </h2>
      <Row title="JudgeBadge">
        {JUDGE.map((b) => (
          <span key={b} className="inline-flex items-center gap-1">
            <code className="text-2xs text-fg-subtle">{b}</code>
            {b === 'none' ? <span className="text-2xs text-fg-muted">렌더 없음</span> : <JudgeBadge badge={b} />}
          </span>
        ))}
      </Row>
      <Row title="LevelBadge">
        {([1, 2, 3, 4, 5] as const).map((l) => (
          <LevelBadge key={l} level={l} />
        ))}
        <LevelBadge level={3} provisional />
      </Row>
      <Row title="AiModeChip">
        {(['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE'] as const).map((m) => (
          <AiModeChip key={m} mode={m} />
        ))}
        <AiModeChip mode="FULL" degraded />
      </Row>
      <Row title="StateTag">
        {STATES.map((s) => (
          <StateTag key={s} state={s} />
        ))}
      </Row>
      <Row title="StatusDot">
        {DOTS.map((s) => (
          <StatusDot key={s} state={s} />
        ))}
      </Row>
      <Row title="TierTag">
        {(['A', 'B', 'C'] as const).map((t) => (
          <TierTag key={t} tier={t} />
        ))}
      </Row>
      <Row title="TrustTag">
        {(['seed', 'verified', 'user', 'llm_unverified'] as const).map((t) => (
          <TrustTag key={t} trust={t} />
        ))}
      </Row>
      <Row title="DataClassTag">
        {(['C0', 'C1', 'C2', 'C3'] as const).map((c) => (
          <DataClassTag key={c} dataClass={c} />
        ))}
      </Row>
    </section>
  );
}
