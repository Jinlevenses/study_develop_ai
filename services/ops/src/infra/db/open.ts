import { fileURLToPath } from 'node:url';
import type { ServiceDatabase, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { OpsInfra } from '../../config.js';
import { aiGatewayClient } from '../clients/ai-gateway.client.js';
import { contentClient } from '../clients/content.client.js';
import { gatewayClient } from '../clients/gateway.client.js';
import { learningClient } from '../clients/learning.client.js';
import type { IpcChannel } from '../supervisor-ipc/channel.js';
import { processIpcChannel } from '../supervisor-ipc/channel.js';
import type { SupervisorControl } from '../supervisor-ipc/client.js';
import { createSupervisorControl } from '../supervisor-ipc/client.js';

// DB-01 §2·§10 — ops.db(백업·헬스·텔레메트리·업그레이드). ops-api만 연다.
export const OPS_DB: ServiceDatabase = {
  file: 'ops.db',
  applicationId: 0x46544f50,
  profile: 'full',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [
    { module: 'backup', dir: fileURLToPath(new URL('../../../migrations/backup/', import.meta.url)) },
    { module: 'health', dir: fileURLToPath(new URL('../../../migrations/health/', import.meta.url)) },
    { module: 'telemetry', dir: fileURLToPath(new URL('../../../migrations/telemetry/', import.meta.url)) },
    { module: 'upgrade', dir: fileURLToPath(new URL('../../../migrations/upgrade/', import.meta.url)) },
  ],
};

/**
 * `channel` 생략 = 이 프로세스의 IPC 채널(없으면 null). 명시적 `null` = supervisor 없음(테스트·단독 기동).
 * 채널 리스너는 첫 요청에서 등록된다(생성만으로는 `process.on('message')` 0).
 */
export function openInfra(deps: ServiceDeps<null>, opts?: { readonly channel?: IpcChannel | null }): OpsInfra {
  const db = deps.dbs[OPS_DB.file];
  if (db === undefined) {
    throw new Error(`invariant: db ${OPS_DB.file} not opened`);
  }
  const channel = opts?.channel === undefined ? processIpcChannel() : opts.channel;
  let supervisor: SupervisorControl | null = null;
  if (channel !== null) {
    const control = createSupervisorControl({ channel, log: deps.log });
    deps.onShutdown(() => control.close());
    supervisor = control;
  }
  return {
    db,
    peers: {
      gateway: gatewayClient(deps.peers),
      content: contentClient(deps.peers),
      learning: learningClient(deps.peers),
      'ai-gateway': aiGatewayClient(deps.peers),
    },
    supervisor,
  };
}
