import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { LearnerModelDeps } from './ports.js';

export function registerLearnerModel(_app: ServiceApp, _deps: LearnerModelDeps): void {
  // IT-00 골격: 라우트·구독 0. http/learner-model/** 결선은 이후 서비스 결선 WP가 이 함수 본문에만 추가한다(app.ts 불변).
}
