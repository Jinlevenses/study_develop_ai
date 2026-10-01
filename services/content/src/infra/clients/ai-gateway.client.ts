import type { PeerClientPort, PeerFailure } from '@fathom/shared-kernel/http-client/http-client';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';

// ai-gateway 피어 결선(IT-00: 호출 0) — ARC §11.3 "서킷 open = OFFLINE 간주".
export type AiAvailability = 'reachable' | 'offline';
export interface AiGatewayClient {
  readonly peer: PeerClientPort;
  classify(f: PeerFailure): AiAvailability | 'problem';
}

export function createAiGatewayClient(deps: ServiceDeps<unknown>): AiGatewayClient {
  const peer = deps.peers['ai-gateway'];
  if (peer === undefined) {
    throw new Error('invariant: ai-gateway peer client missing');
  }
  return {
    peer,
    classify(f: PeerFailure): AiAvailability | 'problem' {
      switch (f.kind) {
        case 'connect_failed':
        case 'connect_timeout':
        case 'circuit_open':
        case 'timeout':
        case 'deadline_exhausted':
          return 'offline';
        case 'problem':
        case 'contract_violation':
          return 'problem';
      }
    },
  };
}
