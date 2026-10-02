import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import type { HomeView } from '@fathom/contracts/http/gateway/v1/home';
import { HomeGetRoute } from '@fathom/contracts/http/gateway/v1/home';
import type { Banner as BannerT } from '@fathom/contracts/http/ops/v1/health';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { QueueCounts } from '../../../lib/attempt-queue.js';
import { qk } from '../../../lib/query-keys.js';
import type { SseSnapshot } from '../../../lib/sse.js';
import { useShellDeps } from './shell-deps.js';

/**
 * 홈 뷰(칩·배너의 원천). IT-00 gateway는 이 라우트를 아직 등록하지 않아 404가 나지만
 * 슬롯·칩은 SSE 값으로 동작하므로 오류 UI는 두지 않는다(retry 0).
 */
export function useHomeView(): UseQueryResult<HomeView> {
  const { api } = useShellDeps();
  return useQuery({
    queryKey: qk.home(),
    queryFn: ({ signal }) => api.query(HomeGetRoute, {}, { signal }),
    retry: false,
    staleTime: 30_000,
  });
}

export function useSseSnapshot(): SseSnapshot {
  const { sse } = useShellDeps();
  return useSyncExternalStore(sse.subscribe, sse.getSnapshot);
}

export function useQueueCounts(): QueueCounts {
  const { queueCounts } = useShellDeps();
  return useSyncExternalStore(queueCounts.subscribe, queueCounts.getSnapshot);
}

/** 운영 배너 — 홈 뷰가 있으면 그 값, 없으면 SSE `ops.health.changed`가 마지막으로 실어 온 배너. */
export function useOpsBanners(): readonly BannerT[] {
  const { sse } = useShellDeps();
  const home = useHomeView();
  const [fromSse, setFromSse] = useState<readonly BannerT[]>([]);
  useEffect(
    () =>
      sse.on('ops.health.changed', (data) => {
        const parsed = EVENT_PAYLOADS['ops.health.changed'][1].safeParse(data.payload);
        if (parsed.success) {
          setFromSse(parsed.data.banners);
        }
      }),
    [sse],
  );
  return home.data?.banners ?? fromSse;
}
