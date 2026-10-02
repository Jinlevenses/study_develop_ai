import { Button } from '@fathom/ui/components/button';
import { cn } from '@fathom/ui/lib/cn';
import { iconProps } from '@fathom/ui/lib/icon';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { useHatStore } from '../../../stores/hat.js';
import { usePaletteStore } from '../../../stores/palette.js';
import { AiChip } from './ai-chip.js';
import { ConnectionChip } from './connection-chip.js';
import { HatSwitch } from './hat-switch.js';
import { OpsAlertSlot } from './ops-alert-slot.js';
import { useShellDeps } from './shell-deps.js';
import { useOpsBanners, useQueueCounts, useSseSnapshot } from './use-shell-data.js';

export function AppMark(): ReactElement {
  return (
    <Link to="/" className="shrink-0 font-display text-base font-semibold text-fg">
      Fathom 깊이
    </Link>
  );
}

export function PaletteTrigger(): ReactElement {
  const openPalette = usePaletteStore((s) => s.openPalette);
  return (
    <Button
      variant="ghost"
      title="예: ㄷㅋ → 도커"
      kbd={['Mod', 'K']}
      onClick={openPalette}
      className="min-w-0 text-fg-muted"
    >
      <Search {...iconProps()} />
      <span className="hidden truncate sm:inline">개념·화면·명령 검색…</span>
    </Button>
  );
}

/** GLB-SHELL 헤더 — 관리 모자면 하단 띠가 강해진다(ShellLayout.admin). */
export function AppHeader(): ReactElement {
  const hat = useHatStore((s) => s.hat);
  const { status } = useShellDeps();
  const banners = useOpsBanners();
  const sse = useSseSnapshot();
  const queue = useQueueCounts();
  return (
    <header
      className={cn(
        'sticky top-0 z-(--z-sticky) flex h-(--shell-header-h) items-center gap-3 border-b bg-surface-1 px-4',
        hat === 'admin' ? 'border-border-strong' : 'border-border',
      )}
    >
      <AppMark />
      <HatSwitch />
      <PaletteTrigger />
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <OpsAlertSlot banners={banners} hat={hat} />
        <ConnectionChip state={sse.state} queue={queue} safeMode={status?.safe_mode === true} />
        <AiChip />
      </div>
    </header>
  );
}
