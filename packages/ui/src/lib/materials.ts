// DS-01 §6.1 재질 → 클래스 문자열
export const MATERIAL = {
  inline: 'rounded-inline border border-border bg-surface-2',
  control: 'rounded-control border border-border-input bg-surface-2',
  panel: 'rounded-panel border border-border bg-surface-1 shadow-panel',
  popover: 'rounded-popover border border-border-strong bg-surface-3 light:bg-surface-1 shadow-popover', // 다크 s3 · 라이트 s1(§6.1)
  modal: 'rounded-modal border border-border-strong bg-surface-1 shadow-modal',
  drawer: 'border-border-strong bg-surface-1 shadow-popover',
  pill: 'rounded-pill',
} as const;
