import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { iconProps } from '../lib/icon.js';
import { Button } from './button.js';
import { IconButton } from './icon-button.js';

export type BannerSeverity = 'info' | 'warn' | 'critical';
export type BannerAction = { label: string; onSelect?: () => void; href?: string };

export type BannerProps = {
  severity: BannerSeverity;
  variant?: 'inline' | 'slot' | 'suggest';
  title: string;
  description?: string;
  action?: BannerAction;
  onDismiss?: () => void;
  className?: string;
};

const ICON = {
  info: { Icon: Info, tone: 'text-fg-muted', sr: '안내:' },
  warn: { Icon: TriangleAlert, tone: 'text-due', sr: '주의:' },
  critical: { Icon: CircleAlert, tone: 'text-danger', sr: '중요:' },
} as const;

export function Banner({
  severity,
  variant = 'inline',
  title,
  description,
  action,
  onDismiss,
  className,
}: BannerProps): ReactElement {
  const { Icon, tone, sr } = ICON[severity];
  return (
    <div
      role="status"
      data-severity={severity}
      data-variant={variant}
      className={cn(
        'flex items-center gap-2 rounded-control border border-border bg-surface-2 px-3 text-sm text-fg',
        variant === 'slot' ? 'py-1' : 'py-2',
        variant === 'suggest' && 'border-dashed',
        className,
      )}
    >
      <span className={tone}>
        <Icon {...iconProps()} />
      </span>
      <span className="sr-only">{sr}</span>
      <div className={cn('flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2', variant === 'slot' && 'truncate')}>
        <span className="font-medium">{title}</span>
        {description === undefined ? null : <span className="text-fg-muted">{description}</span>}
      </div>
      {action === undefined ? null : action.href !== undefined ? (
        <Button asChild variant="secondary" size="sm">
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={action.onSelect}>
          {action.label}
        </Button>
      )}
      {onDismiss === undefined ? null : <IconButton aria-label="닫기" icon={X} size="sm" onClick={onDismiss} />}
    </div>
  );
}
