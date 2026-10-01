import type { InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';
import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { ContentPolicies } from '../../config.js';

// acquisition BC 등록 지점 — 라우트·inbox 핸들러는 소유 WP가 이 파일에 가산(app.ts 변경 불필요). 핸들러 파일 = application/acquisition/inbox/<type-hyphen>.ts(STD-NAM-74).

export function registerAcquisition(_app: ServiceApp, _deps: ServiceDeps<ContentPolicies>): void {}

export const acquisitionInboxHandlers: readonly InboxHandlerDef[] = [];
