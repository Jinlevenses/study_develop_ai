import type { LucideIcon } from 'lucide-react';
import { ArrowUpFromLine, CalendarCheck, Diamond, Dot, ListChecks, Shuffle, Unlink } from 'lucide-react';
import type { ReactElement } from 'react';
import { iconProps } from '../lib/icon.js';
import { MATERIAL } from '../lib/materials.js';

export type ReasonChipProps = {
  code: string;
  label: string;
  value?: string | null;
};

const ICON: Record<string, LucideIcon> = {
  due: ArrowUpFromLine,
  keystone: Diamond,
  boss: Diamond,
  wildcard: Shuffle,
  weak: Unlink,
  weekly_quota: CalendarCheck,
  verify: ListChecks,
};

export function ReasonChip({ code, label, value }: ReasonChipProps): ReactElement {
  const Icon = Object.hasOwn(ICON, code) ? (ICON[code] ?? Dot) : Dot;
  return (
    <span data-code={code} className={`${MATERIAL.inline} inline-flex items-center gap-1 px-1.5 text-2xs text-fg`}>
      <Icon {...iconProps()} />
      {label}
      {value === undefined || value === null ? null : <span className="num text-fg-muted">{value}</span>}
    </span>
  );
}
