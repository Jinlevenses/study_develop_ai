import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { PrivacyDeps } from './ports.js';

export function registerPrivacy(_app: ServiceApp, _deps: PrivacyDeps): void {
  // IT-00 골격: 라우트·구독 0. http/privacy/** 결선은 이후 서비스 결선 WP가 이 함수 본문에만 추가한다(app.ts 불변).
}
