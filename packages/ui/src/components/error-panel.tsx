import { CircleAlert, Copy } from 'lucide-react';
import { type ReactElement, useEffect, useRef } from 'react';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';
import { Button } from './button.js';
import { IconButton } from './icon-button.js';

export type ErrorPanelProblem = { title: string; code: string; detail?: string; error_id?: string | null };
export type ErrorPanelAction = { label: string; onSelect: () => void };

export type ErrorPanelProps = {
  problem: ErrorPanelProblem;
  actions: readonly ErrorPanelAction[];
};

function copyText(text: string): void {
  try {
    void Promise.resolve(navigator.clipboard?.writeText(text)).catch(() => undefined);
  } catch {
    // 클립보드를 쓸 수 없는 환경 — 복사 실패는 조용히 무시한다.
  }
}

export function ErrorPanel({ problem, actions }: ErrorPanelProps): ReactElement {
  const firstAction = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstAction.current?.focus();
  }, []);
  const errorId = problem.error_id;
  return (
    <div role="alert" className={`${MATERIAL.panel} flex flex-col gap-3 p-(--panel-p) text-fg`}>
      <div className="flex items-start gap-2">
        <span className="text-incorrect">
          <CircleAlert {...iconProps()} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">{problem.title}</p>
          {problem.detail === undefined ? null : <p className="text-sm text-fg-muted">{problem.detail}</p>}
          <p className="text-xs text-fg-muted">
            <code className="font-mono">{problem.code}</code>
          </p>
          {errorId === undefined || errorId === null ? null : (
            <p className="inline-flex items-center gap-1 text-xs text-fg-muted">
              오류 ID <code className="font-mono">{errorId}</code>
              <IconButton aria-label="오류 ID 복사" icon={Copy} size="sm" onClick={() => copyText(errorId)} />
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a, i) => (
          <Button key={a.label} ref={i === 0 ? firstAction : undefined} variant="secondary" onClick={a.onSelect}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
