import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { LogLevel } from '@fathom/shared-kernel/log/log';
import { appPath } from './bundle.js';
import { listenPortFor, peerUrls } from './ports.js';

export type EnvelopeContext = {
  readonly profile: RuntimeProfile;
  readonly home: string;
  readonly appRoot: string;
  readonly appVersion: string;
  readonly contractsHash: string;
  readonly tokens: Readonly<Record<ServiceName, string>>;
  readonly lastPort: number | null;
  readonly knownPorts: Readonly<Partial<Record<ServiceName, number | null>>>;
  readonly safeMode: boolean;
  readonly afterCrash: boolean;
  readonly logLevel: LogLevel;
};

/**
 * ADR-012 §3 봉투. `boot_id`는 fork마다 새 값(gateway SSE가 서비스 재시작을 감지). `callers`는 5키 전부 —
 * 실제 호출 ACL은 라우트 `allowedCallers`가 집행한다(CR 후보 ⑥). 송신 전 계약으로 parse한다.
 */
export function buildEnvelope(svc: ServiceName, ctx: EnvelopeContext): BootstrapEnvelope {
  return BootstrapEnvelope.parse({
    type: 'bootstrap',
    v: 1,
    svc,
    boot_id: ulid(),
    app_version: ctx.appVersion,
    contracts_hash: ctx.contractsHash,
    profile: ctx.profile,
    home: ctx.home,
    web_root: svc === 'gateway' && ctx.profile !== 'dev' ? appPath(ctx.appRoot, 'apps/web/dist') : null,
    listen: { host: '127.0.0.1', port: listenPortFor(svc, ctx.profile, ctx.lastPort) },
    self_token: ctx.tokens[svc],
    callers: { ...ctx.tokens },
    peers: peerUrls(ctx.profile, ctx.knownPorts),
    flags: { safe_mode: ctx.safeMode, batch_enabled: !ctx.safeMode, after_crash: ctx.afterCrash },
    log_level: ctx.logLevel,
  });
}
