import { fileURLToPath } from 'node:url';
import { createService, realProcessPort } from '@fathom/shared-kernel/service/service';
import { createGatewayDefinition } from '../../../src/config.js';

// 통합 테스트용 gateway 진입점 — 실제 main.ts와 같은 모양에 `--fx-web-root=<dir>`만 더한다(createService의 argv 파서는 모르는 키를 거부한다).

const real = realProcessPort();
const fx = real.argv.filter((a) => a.startsWith('--fx-'));
const webRoot = fx.find((a) => a.startsWith('--fx-web-root='))?.slice('--fx-web-root='.length);
const port = { ...real, argv: real.argv.filter((a) => !a.startsWith('--fx-')) };

await createService(
  createGatewayDefinition({
    entry: fileURLToPath(import.meta.url),
    ...(webRoot === undefined ? {} : { webRoot }),
  }),
  { process: port },
);
