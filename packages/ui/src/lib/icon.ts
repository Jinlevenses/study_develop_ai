export type IconSize = 16 | 20;

/** lucide 아이콘 공통 props — 크기 16·20, stroke 1.5, 장식 아이콘은 aria-hidden. */
export function iconProps(size: IconSize = 16): { size: IconSize; strokeWidth: 1.5; 'aria-hidden': true } {
  return { size, strokeWidth: 1.5, 'aria-hidden': true };
}
