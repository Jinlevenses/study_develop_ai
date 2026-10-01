import { QueryClient } from '@tanstack/react-query';
import { ApiError, isRetryable } from './api-client.js';

/** 조회 재시도 정책 — 재시도 가능 실패만, 최대 2회 재시도(count 0·1·2 → true, 3 → false). */
export function shouldRetryQuery(count: number, err: unknown): boolean {
  return count < 3 && err instanceof ApiError && isRetryable(err.failure);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
        retryDelay: (n: number): number => Math.min(30_000, 1000 * 2 ** n),
      },
      mutations: { retry: false },
    },
  });
}
