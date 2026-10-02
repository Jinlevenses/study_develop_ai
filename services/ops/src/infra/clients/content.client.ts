import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';

// content 피어 호출 클라이언트(PeerClient). 라우트별 래퍼는 이후 반복이 `call(route, …)`로 쓴다.
export function contentClient(peers: ServiceDeps<null>['peers']): PeerClientPort {
  const client = peers.content;
  if (client === undefined) {
    throw new Error('invariant: peer client content missing');
  }
  return client;
}
