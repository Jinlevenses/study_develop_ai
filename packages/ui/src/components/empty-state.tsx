import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { iconProps } from '../lib/icon.js';
import { Button } from './button.js';

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action: { label: string; onSelect: () => void };
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="text-fg-muted">
        <Icon {...iconProps(20)} />
      </span>
      <p className="text-base text-fg">{title}</p>
      {description === undefined ? null : <p className="max-w-130 text-sm text-fg-muted">{description}</p>}
      <Button variant="secondary" onClick={action.onSelect}>
        {action.label}
      </Button>
    </div>
  );
}
