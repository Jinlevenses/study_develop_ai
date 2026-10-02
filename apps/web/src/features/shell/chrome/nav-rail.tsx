import { IconButton } from '@fathom/ui/components/icon-button';
import { Tooltip } from '@fathom/ui/components/tooltip';
import { iconProps } from '@fathom/ui/lib/icon';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  BookOpen,
  CalendarCheck,
  CircleHelp,
  Cpu,
  Flag,
  House,
  Import,
  Inbox,
  Library,
  type LucideIcon,
  Map as MapIcon,
  Play,
  Settings,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { type Hat, useHatStore } from '../../../stores/hat.js';
import { useHotkeysStore } from '../../../stores/hotkeys.js';
import { usePaletteStore } from '../../../stores/palette.js';

type RailTo = '/' | '/inbox' | '/map' | '/review/weekly' | '/season' | '/curation' | '/ai' | '/ops' | '/settings';

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly to: RailTo;
  /** 같은 경로의 다른 화면과 구분하는 `?tab=` 값. */
  readonly tab?: 'imports';
  /** 현재 경로 표시를 하지 않는 자리표시 항목(IT-00의 `세션`). */
  readonly noCurrent?: boolean;
  /** 링크 대신 명령 팔레트를 여는 항목(`개념`). */
  readonly action?: 'palette';
}

const LEARN_GROUP: readonly RailItem[] = [
  { id: 'home', label: '홈', icon: House, to: '/' },
  { id: 'session', label: '세션', icon: Play, to: '/', noCurrent: true },
  { id: 'concepts', label: '개념', icon: BookOpen, to: '/', noCurrent: true, action: 'palette' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, to: '/inbox' },
];
const MAP_GROUP: readonly RailItem[] = [{ id: 'map', label: '지도', icon: MapIcon, to: '/map' }];
const REVIEW_GROUP: readonly RailItem[] = [
  { id: 'review', label: '주간 리뷰', icon: CalendarCheck, to: '/review/weekly' },
  { id: 'season', label: '시즌', icon: Flag, to: '/season' },
];
const ADMIN_GROUP: readonly RailItem[] = [
  { id: 'imports', label: '가져오기', icon: Import, to: '/inbox', tab: 'imports' },
  { id: 'curation', label: '큐레이션', icon: Library, to: '/curation' },
  { id: 'ai', label: 'AI', icon: Cpu, to: '/ai' },
  { id: 'ops', label: '운영', icon: Activity, to: '/ops' },
  { id: 'settings', label: '설정', icon: Settings, to: '/settings' },
];

function useIsCurrent(): (item: RailItem) => boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = useRouterState({ select: (s) => new URLSearchParams(s.location.searchStr).get('tab') });
  return (item) => {
    if (item.noCurrent === true) {
      return false;
    }
    if (item.to === '/') {
      return pathname === '/';
    }
    if (pathname !== item.to && !pathname.startsWith(`${item.to}/`)) {
      return false;
    }
    if (item.to === '/inbox') {
      return item.tab === 'imports' ? tab === 'imports' : tab !== 'imports';
    }
    return true;
  };
}

const ITEM_CLASS =
  'flex h-9 w-full items-center justify-center gap-2 rounded-control px-2 text-fg-muted hover:bg-state-hover aria-[current=page]:bg-state-selected aria-[current=page]:text-fg xl:justify-start';

function RailEntry({ item, current }: { item: RailItem; current: boolean }): ReactElement {
  const openPalette = usePaletteStore((s) => s.openPalette);
  const Icon = item.icon;
  const content = (
    <>
      <Icon {...iconProps(20)} />
      <span className="hidden text-sm xl:inline">{item.label}</span>
    </>
  );
  if (item.action === 'palette') {
    return (
      <Tooltip content="개념 검색" side="right">
        <button type="button" aria-label={item.label} className={ITEM_CLASS} onClick={openPalette}>
          {content}
        </button>
      </Tooltip>
    );
  }
  const common = {
    'aria-label': item.label,
    'aria-current': current ? ('page' as const) : undefined,
    className: ITEM_CLASS,
  };
  return (
    <Tooltip content={item.label} side="right">
      {item.tab === 'imports' ? (
        <Link to="/inbox" search={{ tab: 'imports' }} {...common}>
          {content}
        </Link>
      ) : (
        <Link to={item.to} {...common}>
          {content}
        </Link>
      )}
    </Tooltip>
  );
}

function Group({ items, label }: { items: readonly RailItem[]; label: string }): ReactElement {
  const isCurrent = useIsCurrent();
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <RailEntry item={item} current={isCurrent(item)} />
        </li>
      ))}
    </ul>
  );
}

/** md 이상 좌측 레일(SCR §2.1·§4.3) — 관리 그룹은 관리 모자에서만 렌더한다. */
export function NavRail(): ReactElement {
  const hat: Hat = useHatStore((s) => s.hat);
  const openHelp = useHotkeysStore((s) => s.openHelp);
  return (
    <nav
      aria-label="주요 메뉴"
      className="hidden w-(--shell-rail-w) shrink-0 flex-col gap-3 border-r border-border bg-surface-1 p-2 md:flex xl:w-(--shell-rail-w-wide)"
    >
      <Group items={LEARN_GROUP} label="학습" />
      <Group items={MAP_GROUP} label="지도" />
      <Group items={REVIEW_GROUP} label="리뷰" />
      {hat === 'admin' ? <Group items={ADMIN_GROUP} label="관리" /> : null}
      <div className="mt-auto">
        <IconButton aria-label="단축키 도움말" icon={CircleHelp} onClick={openHelp} />
      </div>
    </nav>
  );
}

const TAB_ITEMS: readonly RailItem[] = [
  { id: 'home', label: '홈', icon: House, to: '/' },
  { id: 'session', label: '세션', icon: Play, to: '/', noCurrent: true },
  { id: 'map', label: '지도', icon: MapIcon, to: '/map' },
  { id: 'review', label: '리뷰', icon: CalendarCheck, to: '/review/weekly' },
];

/** md 미만 하단 탭 4개(홈·세션·지도·리뷰). */
export function BottomTabs(): ReactElement {
  const isCurrent = useIsCurrent();
  return (
    <nav
      aria-label="하단 메뉴"
      className="sticky bottom-0 z-(--z-sticky) flex items-center justify-around border-t border-border bg-surface-1 py-1 md:hidden"
    >
      {TAB_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.id}
            to={item.to}
            aria-label={item.label}
            aria-current={isCurrent(item) ? 'page' : undefined}
            className="flex min-w-16 flex-col items-center gap-0.5 rounded-control px-3 py-1 text-fg-muted aria-[current=page]:text-fg"
          >
            <Icon {...iconProps(20)} />
            <span className="text-2xs">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
