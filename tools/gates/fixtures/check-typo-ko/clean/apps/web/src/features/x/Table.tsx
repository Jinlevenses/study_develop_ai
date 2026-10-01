declare function cn(...a: string[]): string;
type Pair<i> = Array<i>;

export const A = <td data-numeric className="num text-right">1</td>;
export const B = <td data-numeric className={cn('x', 'num')}>2</td>;
export const C = <td className="text-right">no numeric attr</td>;
export const D = <em>강조는 굵기로</em>;
export const E = <p className="text-base">본문</p>;
export const F = <span className="text-xs">캡션은 span 이면 허용</span>;
export const G = (x: number, i: number) => x <i;
export const H = (n: Pair<number>) => n;
// biome-ignore lint/plugin: 아이콘 폰트 글리프 — 사유가 있는 예외
export const I = <i>glyph</i>;
