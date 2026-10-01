import { TriangleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { iconProps } from '../lib/icon.js';

export type MeterProps = {
  label: string;
  value: number;
  max: number;
  valueText?: string;
};

export function Meter({ label, value, max, valueText }: MeterProps): ReactElement {
  const now = Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  const warn = ratio >= 0.8;
  const full = ratio >= 1;
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-fg">
        <span className="inline-flex items-center gap-1.5">
          {warn ? (
            <>
              <span className="text-due">
                <TriangleAlert {...iconProps()} />
              </span>
              <span className="sr-only">주의</span>
            </>
          ) : null}
          {label}
        </span>
        <span className="num text-fg-muted">
          {valueText ?? `${now} / ${max}`}
          {full ? ' · 한도 도달' : ''}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: DS-01 §9.2는 role="meter" 막대 + 값 텍스트 구조를 지정한다(<meter>는 막대 스타일 불가) */}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={valueText}
        className="h-1 w-full overflow-hidden rounded-pill bg-surface-3"
      >
        <div className="h-full rounded-pill bg-fg-muted" style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}
