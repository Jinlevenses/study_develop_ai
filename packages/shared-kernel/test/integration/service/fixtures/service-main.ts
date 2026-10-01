// 통합 테스트용 서비스 진입점 — 실제 `main.ts`와 같은 모양(`createService(def)` 한 줄)이다.
import { createService } from '../../../../src/service/boot.js';
import { fixtureDef } from './def.js';

await createService(fixtureDef());
