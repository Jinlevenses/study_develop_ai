import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';

// IF-GW-095~133 그룹 — 라우트 0개. 소유 WP가 이 파일에 등록한다(app.ts 변경 불필요).
export function registerApiCurationRoutes(_app: ServiceApp, _deps: ServiceDeps<null>, _ctx: GatewayContext): void {}
