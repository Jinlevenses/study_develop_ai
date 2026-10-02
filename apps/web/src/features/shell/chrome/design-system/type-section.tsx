import type { ReactElement } from 'react';

const SCALE = [
  ['text-2xs', 'text-2xs'],
  ['text-xs', 'text-xs'],
  ['text-sm', 'text-sm'],
  ['text-base', 'text-base'],
  ['text-read', 'text-read'],
  ['text-lg', 'text-lg'],
  ['text-xl', 'text-xl'],
  ['text-2xl', 'text-2xl'],
  ['text-3xl', 'text-3xl'],
  ['text-display', 'text-display'],
] as const;

/** 타이포 스케일 + 한영 혼용 기준 문단(DS-01 §12). */
export function TypeSection(): ReactElement {
  return (
    <section aria-labelledby="ds-type" className="flex flex-col gap-3">
      <h2 id="ds-type" className="text-lg text-fg">
        타이포
      </h2>
      <ul className="flex flex-col gap-2">
        {SCALE.map(([name, cls]) => (
          <li key={name} className="flex items-baseline gap-3">
            <code className="w-24 shrink-0 text-xs text-fg-muted">{name}</code>
            <span className={cls}>깊이로 내려가는 학습 Fathom</span>
          </li>
        ))}
      </ul>
      <p className="max-w-(--measure-read) text-read">보존율(retention)은 기억이 남아 있을 확률이다 — FSRS 0.90 기준</p>
    </section>
  );
}
