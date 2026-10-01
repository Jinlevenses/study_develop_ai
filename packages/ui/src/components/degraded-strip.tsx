import { CircleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { iconProps } from '../lib/icon.js';
import { Button } from './button.js';

export type DegradedStripProps = {
  detail: string;
  retryInSec?: number | null;
  onRetry?: () => void;
};

export function DegradedStrip({ detail, retryInSec, onRetry }: DegradedStripProps): ReactElement {
  const retry = retryInSec === undefined || retryInSec === null ? '' : ` · ${retryInSec}초 후 다시 시도`;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-control border border-dashed border-border-strong px-3 py-2 text-sm text-fg"
    >
      <span className="text-fg-muted">
        <CircleAlert {...iconProps()} />
      </span>
      <span className="flex-1">{`일부 정보를 불러오지 못했습니다(${detail})${retry}`}</span>
      {onRetry === undefined ? null : (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          다시 불러오기
        </Button>
      )}
    </div>
  );
}
