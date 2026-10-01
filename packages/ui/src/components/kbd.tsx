import type { ReactElement } from 'react';
import { cn } from '../lib/cn.js';
import { MATERIAL } from '../lib/materials.js';

export type KbdPlatform = 'mac' | 'other';

export type KbdProps = {
  keys: readonly string[];
  size?: 'sm' | 'md';
  platform?: KbdPlatform;
  className?: string;
};

function detectPlatform(): KbdPlatform {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? 'mac' : 'other';
}

function label(key: string, platform: KbdPlatform): string {
  if (key === 'Mod') {
    return platform === 'mac' ? '⌘' : 'Ctrl';
  }
  if (key === 'Shift' && platform === 'mac') {
    return '⇧';
  }
  return key;
}

export function Kbd({ keys, size = 'md', platform, className }: KbdProps): ReactElement {
  const resolved = platform ?? detectPlatform();
  const text = keys.map((k) => label(k, resolved)).join(resolved === 'mac' ? '' : '+');
  return (
    <kbd
      className={cn(MATERIAL.inline, 'font-mono text-2xs px-1 text-fg-muted', size === 'sm' ? 'h-4' : 'h-5', className)}
    >
      {text}
    </kbd>
  );
}
