import type { ServiceName } from '@fathom/contracts/common/ids';
import { assertDefined } from '@fathom/shared-kernel/errors/errors';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';

/** 선언한 피어의 클라이언트 — 없으면 결선 결함이다(`def.peers`에 없는 서비스를 부른 경우). */
export function requirePeer(deps: ServiceDeps<unknown>, svc: ServiceName): PeerClientPort {
  return assertDefined(deps.peers[svc], `peer client missing: ${svc}`);
}
