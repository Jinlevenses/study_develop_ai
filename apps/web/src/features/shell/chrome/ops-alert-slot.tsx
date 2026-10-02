import type { Banner as BannerT } from '@fathom/contracts/http/ops/v1/health';
import { Banner } from '@fathom/ui/components/banner';
import type { ReactElement } from 'react';
import type { Hat } from '../../../stores/hat.js';

export interface OpsAlertSlotProps {
  readonly banners: readonly BannerT[];
  readonly hat: Hat;
}

const RANK = { critical: 2, warn: 1, info: 0 } as const;

/** Header의 운영 알림 슬롯 — info 제외, critical > warn, 같은 등급은 최신 1개, 나머지는 `+n`. */
export function OpsAlertSlot({ banners, hat }: OpsAlertSlotProps): ReactElement | null {
  const shown = banners
    .filter((b) => b.severity !== 'info')
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.since - a.since);
  const top = shown[0];
  if (top === undefined) {
    return null;
  }
  const href = top.action?.href ?? null;
  const action =
    hat === 'admin' && top.action !== null && href !== null ? { label: top.action.label_ko, href } : undefined;
  const rest = shown.length - 1;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Banner severity={top.severity} variant="slot" title={top.message_ko} action={action} />
      {rest > 0 ? <span className="text-xs text-fg-muted">{`+${String(rest)}`}</span> : null}
    </div>
  );
}
