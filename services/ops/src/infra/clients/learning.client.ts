import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';

// learning 피어 호출 클라이언트(PeerClient). 라우트별 래퍼는 이후 반복이 `call(route, …)`로 쓴다.
export function learningClient(peers: ServiceDeps<null>['peers']): PeerClientPort {
  const client = peers.learning;
  if (client === undefined) {
    throw new Error('invariant: peer client learning missing');
  }
  return client;
}
