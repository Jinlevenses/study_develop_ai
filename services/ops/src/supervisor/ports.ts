import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { ServiceName } from '@fathom/contracts/common/ids';

// ADR-012 §5 포트 표(AQ-08). 예약 4765/4865는 쓰지 않는다. test 프로파일은 전부 OS 할당(0).
export const VITE_PORT = 5173;

export const PREFERRED_PORTS: Readonly<Record<RuntimeProfile, Readonly<Record<ServiceName, number>>>> = {
  prod: { gateway: 4747, 'ops-api': 4761, content: 4762, learning: 4763, 'ai-gateway': 4764 },
  dev: { gateway: 4847, 'ops-api': 4861, content: 4862, learning: 4863, 'ai-gateway': 4864 },
  test: { gateway: 0, 'ops-api': 0, content: 0, learning: 0, 'ai-gateway': 0 },
};

const SERVICE_NAMES: readonly ServiceName[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) {
    out.push(p);
  }
  return out;
}

/** gateway의 순차 bind 후보(실제 bind는 gateway가 `def.portFallbacks`로 한다). */
export function gatewayFallbacks(profile: RuntimeProfile): readonly number[] {
  if (profile === 'prod') {
    return range(4748, 4756);
  }
  return profile === 'dev' ? range(4848, 4856) : [];
}

/** 재시작 시 직전 포트를 먼저 재사용한다(ADR-012 §5). */
export function listenPortFor(svc: ServiceName, profile: RuntimeProfile, lastPort: number | null): number {
  return lastPort ?? PREFERRED_PORTS[profile][svc];
}

export type PortClass = 'preferred' | 'fallback' | 'os';

export function classifyPort(svc: ServiceName, profile: RuntimeProfile, port: number): PortClass {
  if (port === PREFERRED_PORTS[profile][svc]) {
    return 'preferred';
  }
  if (svc === 'gateway' && gatewayFallbacks(profile).includes(port)) {
    return 'fallback';
  }
  return 'os';
}

export type PeerUrls = Record<ServiceName, { url: string }>;

/** 5개 서비스 전부(자기 자신 포함). 미확정 포트는 선호 포트(test는 `:0`). */
export function peerUrls(
  profile: RuntimeProfile,
  known: Readonly<Partial<Record<ServiceName, number | null>>>,
): PeerUrls {
  const out: Partial<PeerUrls> = {};
  for (const svc of SERVICE_NAMES) {
    out[svc] = { url: `http://127.0.0.1:${known[svc] ?? PREFERRED_PORTS[profile][svc]}` };
  }
  return out as PeerUrls;
}
