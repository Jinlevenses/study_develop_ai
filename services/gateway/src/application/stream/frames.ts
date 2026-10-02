import type { AiMode } from '@fathom/contracts/common/domain';
import type { SseResync } from '@fathom/contracts/http/gateway/v1/stream';
import { SseHello } from '@fathom/contracts/http/gateway/v1/stream';

// IF §2.13 SSE 프레임 — `id: <boot>.<seq>` · `event: <type>` · `data: <JSON 한 줄>` + 빈 줄. heartbeat = 주석 줄.

export function retryFrame(ms: number): string {
  return `retry: ${ms}\n\n`;
}

export function dataFrame(boot: string, seq: number, type: string, data: string): string {
  return `id: ${boot}.${seq}\nevent: ${type}\ndata: ${data}\n\n`;
}

export function heartbeatFrame(epochMs: number): string {
  return `: hb ${epochMs}\n\n`;
}

export function helloFrame(
  boot: string,
  resume: number,
  o: { readonly serverTime: number; readonly appVersion: string; readonly aiMode: AiMode },
): string {
  const hello = SseHello.parse({
    boot_id: boot,
    hub_seq: resume,
    server_time: o.serverTime,
    app_version: o.appVersion,
    ai_mode: o.aiMode,
  });
  return dataFrame(boot, resume, 'hello', JSON.stringify(hello));
}

export function resyncFrame(boot: string, head: number, reason: SseResync['reason']): string {
  return dataFrame(boot, head, 'resync', JSON.stringify({ reason }));
}
