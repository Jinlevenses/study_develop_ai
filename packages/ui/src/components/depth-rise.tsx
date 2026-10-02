import { EASE, TOKENS } from '@fathom/design-tokens/tokens';
import { motion } from 'motion/react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { useReducedMotionPreference } from '../motion.js';

export type DepthRiseProps = {
  readonly fromRatio: number;
  readonly toRatio: number;
  readonly label: string;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(Math.max(n, 0), 1);
}

const TRACK = 'relative flex h-16 w-2 items-end overflow-hidden rounded-pill bg-surface-3';
const FILL = 'w-full rounded-pill bg-depth-3';

/**
 * 세션 리포트의 깊이 게이지 "떠오름" — 앱 전체에서 유일한 축하 연출(DS-01 §7.2-7, FR-DSH-008).
 * 높이가 `fromRatio → toRatio`로 720ms 1회 올라가고(반복·카운트업 0), reduced-motion이면 최종 상태를 즉시 그린다.
 */
export function DepthRise({ fromRatio, toRatio, label }: DepthRiseProps): ReactElement {
  const reduced = useReducedMotionPreference();
  const from = clamp01(fromRatio);
  const to = clamp01(toRatio);
  const duration = reduced ? 0 : TOKENS.dur.moment / 1000;
  return (
    <div className="inline-flex items-end gap-3 text-fg" data-depth-rise="">
      {/* biome-ignore lint/a11y/useSemanticElements: DS-01 §9.2는 role="meter" 세로 게이지 구조를 지정한다(<meter>는 세로 막대 스타일 불가) */}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(to * 100)}
        aria-valuetext={label}
        data-duration={duration}
        data-ease={reduced ? 'none' : 'emphasized'}
        className={cn(TRACK)}
      >
        {reduced ? (
          <div data-fill="" className={FILL} style={{ blockSize: `${to * 100}%` }} />
        ) : (
          <motion.div
            data-fill=""
            className={FILL}
            initial={{ height: `${from * 100}%` }}
            animate={{ height: `${to * 100}%` }}
            transition={{ duration, ease: EASE.emphasized }}
          />
        )}
      </div>
      <p className="text-base text-fg">{`${label} ▲`}</p>
    </div>
  );
}
