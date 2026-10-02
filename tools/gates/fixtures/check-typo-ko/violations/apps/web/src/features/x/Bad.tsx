declare function cn(...a: string[]): string;

export const A = <p className="break-all">x</p>; // EXPECT[typo-ko/keep-all]
export const B = <span className="italic">x</span>; // EXPECT[typo-ko/no-italic]
export const C = <i>x</i>; // EXPECT[typo-ko/no-italic]
export const D = <td data-numeric className="text-right">1</td>; // EXPECT[typo-ko/tabular-nums]
export const E = <td data-numeric>1</td>; // EXPECT[typo-ko/tabular-nums]
export const F = <div className="w-[13px]">x</div>; // EXPECT[typo-ko/px-literal]
export const G = <p className="text-2xs">x</p>; // EXPECT[typo-ko/body-min]
export const H = <p className={cn('a', 'text-2xs')}>x</p>; // EXPECT[typo-ko/body-min]
export const U = <span className="uppercase">x</span>; // EXPECT[design/no-uppercase]
// biome-ignore lint/plugin: 사유 있는 예외
export const OK = <i>icon-font glyph</i>;
// biome-ignore lint/plugin:
export const BAD = <i>x</i>; // EXPECT[typo-ko/no-italic]
