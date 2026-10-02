import { InternalActivityRoute } from '@fathom/contracts/http/gateway/v1/internal';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { ActivityView } from '@fathom/contracts/http/gateway/v1/internal';

// IF-GW-199 활동 시각 — 호출자 ops-api(파이프라인의 내부 토큰 인증). `view`는 활성 SSE 연결 수를 받아 `ActivityView`를 만든다.

export function registerInternalRoutes(app: ServiceApp, view: () => ActivityView): void {
  app.route(InternalActivityRoute, () => Promise.resolve({ status: 200, body: view() }));
}
