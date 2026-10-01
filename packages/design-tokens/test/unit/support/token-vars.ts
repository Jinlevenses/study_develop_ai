import { type ThemeMode, TOKENS } from '../../../src/tokens.js';

/** TOKENS.color[mode] → CSS 변수 이름 → OKLCH 문자열(별칭은 해석된 값). */
export function tokenVars(mode: ThemeMode): Record<string, string> {
  const c = TOKENS.color[mode];
  const out: Record<string, string> = {
    '--bg': c.bg,
    '--surface-1': c.surface[0],
    '--surface-2': c.surface[1],
    '--surface-3': c.surface[2],
    '--border': c.border.base,
    '--border-strong': c.border.strong,
    '--border-input': c.border.input,
    '--fg': c.fg.base,
    '--fg-muted': c.fg.muted,
    '--fg-subtle': c.fg.subtle,
    '--depth-fog': c.depthFog,
    '--on-depth': c.onDepth,
    '--focus': c.focus,
    '--due': c.due,
    '--due-ink': c.dueInk,
    '--correct': c.correct,
    '--incorrect': c.incorrect,
    '--viz-div-neg': c.viz.div.neg,
    '--viz-div-mid': c.viz.div.mid,
    '--viz-div-pos': c.viz.div.pos,
    '--syn-keyword': c.syntax.keyword,
    '--syn-string': c.syntax.string,
    '--syn-number': c.syntax.number,
    '--syn-function': c.syntax.function,
    '--syn-type': c.syntax.type,
    '--syn-comment': c.syntax.comment,
  };
  for (const level of [1, 2, 3, 4, 5] as const) {
    out[`--depth-${level}`] = c.depth[level];
    out[`--viz-seq-${level}`] = c.viz.seq[level - 1] ?? '';
  }
  return out;
}
