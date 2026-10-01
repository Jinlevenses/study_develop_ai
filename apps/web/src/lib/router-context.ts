import type { QueryClient } from '@tanstack/react-query';
import type { ApiClient } from './api-client.js';

/** 라우터 컨텍스트 타입 — 라우터·`__root.tsx` 순환 import 방지용 타입 파일. */
export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly api: ApiClient;
}
