import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { CurriculumRefDeps } from './ports.js';

export function registerCurriculumRef(_app: ServiceApp, _deps: CurriculumRefDeps): void {
  // IT-00 골격: 라우트·구독 0. http/curriculum-ref/** 결선은 이후 서비스 결선 WP가 이 함수 본문에만 추가한다(app.ts 불변).
}
