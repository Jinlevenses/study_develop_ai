import type { ReactElement } from 'react';

export type StatusDotState = 'ready' | 'restarting' | 'degraded' | 'stopped' | 'ok' | 'warn' | 'fail' | 'skip';

export type StatusDotProps = {
  state: StatusDotState;
  label?: string;
};

const SPEC = {
  ready: { shape: '●', tone: 'text-correct', text: '준비됨' },
  ok: { shape: '●', tone: 'text-correct', text: '정상' },
  restarting: { shape: '◐', tone: 'text-due', text: '재시작 중' },
  degraded: { shape: '◆', tone: 'text-due', text: '격하' },
  warn: { shape: '◆', tone: 'text-due', text: '주의' },
  fail: { shape: '◆', tone: 'text-incorrect', text: '오류' },
  stopped: { shape: '○', tone: 'text-fg-subtle', text: '중지됨' },
  skip: { shape: '○', tone: 'text-fg-subtle', text: '건너뜀' },
} as const;

export function StatusDot({ state, label }: StatusDotProps): ReactElement {
  const spec = SPEC[state];
  return (
    <span data-state={state} className="inline-flex items-center gap-1.5 text-2xs text-fg">
      <span aria-hidden="true" data-shape="" className={spec.tone}>
        {spec.shape}
      </span>
      {label ?? spec.text}
    </span>
  );
}
