// UT-SK-194: `--disable-warning` 없이 migrate 모드를 돌리며 다른 경고가 그대로 흐르는지 본다.
import { createService } from '../../../../src/service/boot.js';
import { fixtureDef } from './def.js';

process.emitWarning('x', 'DeprecationWarning');
await createService(fixtureDef());
