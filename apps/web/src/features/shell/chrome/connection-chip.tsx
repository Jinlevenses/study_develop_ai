import { StatusDot, type StatusDotState } from '@fathom/ui/badges/status-dot';
import { iconProps } from '@fathom/ui/lib/icon';
import { CloudUpload, TriangleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import type { QueueCounts } from '../../../lib/attempt-queue.js';
import type { SseConnState } from '../../../lib/sse.js';

export interface ConnectionChipProps {
  readonly state: SseConnState;
  readonly queue: QueueCounts;
  readonly safeMode: boolean;
}

const DOT: Record<SseConnState, { state: StatusDotState; label: string }> = {
  open: { state: 'ready', label: '연결됨' },
  connecting: { state: 'restarting', label: '재연결 중' },
  reconnecting: { state: 'restarting', label: '재연결 중' },
  closed: { state: 'stopped', label: '연결 끊김' },
};

/** 실시간 연결 상태 + 전송 대기·실패 응답 + 안전 모드(SCR §2.7). */
export function ConnectionChip({ state, queue, safeMode }: ConnectionChipProps): ReactElement {
  const dot = DOT[state];
  const waiting = queue.pending + queue.sending;
  return (
    <div className="flex items-center gap-2" data-conn={state}>
      <StatusDot state={dot.state} label={dot.label} />
      {waiting > 0 ? (
        <span className="inline-flex items-center gap-1 text-2xs text-fg-muted">
          <CloudUpload {...iconProps()} />
          {`전송 대기 ${String(waiting)}`}
        </span>
      ) : null}
      {queue.failed_permanent > 0 ? (
        <span className="inline-flex items-center gap-1 text-2xs text-fg">
          <TriangleAlert {...iconProps()} />
          {`보내지 못한 응답 ${String(queue.failed_permanent)}`}
        </span>
      ) : null}
      {safeMode ? <span className="text-2xs text-fg-muted">안전 모드</span> : null}
    </div>
  );
}
