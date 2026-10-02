import { ActivityView } from '@fathom/contracts/http/gateway/v1/internal';
import type { Clock } from '@fathom/shared-kernel/time/time';

// IF-GW-199 · FR-AI-010 — 마지막 사용자 활동 시각. 활동 = 인증된 브라우저 요청(SSE 연결·heartbeat·CLI 제외, 공개 인증 ⑧).

export interface ActivityTracker {
  touch(nowMs: number): void;
  view(activeStreams: number): ActivityView;
}

export function createActivityTracker(clock: Clock): ActivityTracker {
  const createdAt = clock.now();
  let last: number | null = null;
  return {
    touch(nowMs: number): void {
      last = nowMs;
    },
    view(activeStreams: number): ActivityView {
      return ActivityView.parse({
        last_user_activity_at: last,
        idle_ms: Math.max(0, clock.now() - (last ?? createdAt)),
        active_streams: activeStreams,
      });
    },
  };
}
