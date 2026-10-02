import { SegmentedControl } from '@fathom/ui/components/segmented-control';
import type { ReactElement } from 'react';
import { type Hat, useHatStore } from '../../../stores/hat.js';

const OPTIONS = [
  { value: 'learn', label: '학습' },
  { value: 'admin', label: '관리' },
] as const;

/** 작업 모자(학습·관리) 전환 — 관리 모자에서만 관리 메뉴가 보인다(FR-SET-010). */
export function HatSwitch(): ReactElement {
  const hat = useHatStore((s) => s.hat);
  const setHat = useHatStore((s) => s.setHat);
  return (
    <SegmentedControl
      options={OPTIONS}
      value={hat}
      aria-label="작업 모드"
      size="sm"
      onValueChange={(v) => {
        if (v === 'learn' || v === 'admin') {
          setHat(v satisfies Hat);
        }
      }}
    />
  );
}
