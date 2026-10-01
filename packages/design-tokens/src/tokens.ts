// 원색 리터럴 허용 파일(design/raw-color 예외 경로). 값 정본 = tokens.css (DS-01 §14) — 바꿀 때 함께 바꾼다.
import { toHex } from './color.js';

export type ThemeMode = 'dark' | 'light';
export type Level = 1 | 2 | 3 | 4 | 5;
export interface ContrastPair {
  fg: string;
  bg: string;
  min: 3 | 4.5;
  role: string;
}
export interface FathomTokens {
  color: Record<
    ThemeMode,
    {
      bg: string;
      surface: readonly [string, string, string];
      border: { base: string; strong: string; input: string };
      fg: { base: string; muted: string; subtle: string };
      depth: Record<Level, string>;
      depthFog: string;
      onDepth: string;
      focus: string;
      due: string;
      dueInk: string;
      correct: string;
      incorrect: string;
      viz: {
        seq: readonly [string, string, string, string, string];
        div: { neg: string; mid: string; pos: string };
        ink: string;
        ink2: string;
      };
      syntax: { keyword: string; string: string; number: string; function: string; type: string; comment: string };
    }
  >;
  radius: { inline: 4; control: 6; panel: 10; popover: 12; modal: 16; pill: 999 };
  dur: { instant: 90; fast: 150; base: 220; exit: 160; moment: 720; reduced: 120 };
  space: readonly [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72];
}

export const TOKENS: FathomTokens = {
  color: {
    dark: {
      bg: 'oklch(0.20 0.02 245)',
      surface: ['oklch(0.225 0.022 245)', 'oklch(0.26 0.024 245)', 'oklch(0.30 0.026 245)'],
      border: { base: 'oklch(0.33 0.024 245)', strong: 'oklch(0.42 0.028 245)', input: 'oklch(0.56 0.028 245)' },
      fg: { base: 'oklch(0.955 0.008 230)', muted: 'oklch(0.77 0.018 235)', subtle: 'oklch(0.67 0.02 240)' },
      depth: {
        1: 'oklch(0.88 0.09 185)',
        2: 'oklch(0.81 0.11 200)',
        3: 'oklch(0.74 0.125 222)',
        4: 'oklch(0.68 0.14 250)',
        5: 'oklch(0.63 0.15 280)',
      },
      depthFog: 'oklch(0.34 0.022 245)',
      onDepth: 'oklch(0.20 0.02 245)',
      focus: 'oklch(0.82 0.12 205)',
      due: 'oklch(0.82 0.14 75)',
      dueInk: 'oklch(0.82 0.14 75)',
      correct: 'oklch(0.78 0.15 155)',
      incorrect: 'oklch(0.72 0.16 25)',
      viz: {
        seq: [
          'oklch(0.42 0.10 240)',
          'oklch(0.52 0.12 238)',
          'oklch(0.62 0.13 236)',
          'oklch(0.72 0.12 234)',
          'oklch(0.82 0.10 232)',
        ],
        div: { neg: 'oklch(0.66 0.13 70)', mid: 'oklch(0.45 0.015 245)', pos: 'oklch(0.62 0.12 236)' },
        ink: 'oklch(0.77 0.018 235)',
        ink2: 'oklch(0.67 0.02 240)',
      },
      syntax: {
        keyword: 'oklch(0.78 0.10 280)',
        string: 'oklch(0.82 0.09 160)',
        number: 'oklch(0.83 0.10 75)',
        function: 'oklch(0.84 0.09 215)',
        type: 'oklch(0.80 0.08 190)',
        comment: 'oklch(0.67 0.02 240)',
      },
    },
    light: {
      bg: 'oklch(0.985 0.004 230)',
      surface: ['oklch(1 0 0)', 'oklch(0.962 0.007 230)', 'oklch(0.935 0.009 232)'],
      border: { base: 'oklch(0.90 0.01 235)', strong: 'oklch(0.80 0.014 235)', input: 'oklch(0.64 0.016 235)' },
      fg: { base: 'oklch(0.23 0.03 250)', muted: 'oklch(0.45 0.03 245)', subtle: 'oklch(0.52 0.025 245)' },
      depth: {
        1: 'oklch(0.55 0.09 185)',
        2: 'oklch(0.53 0.08 200)',
        3: 'oklch(0.50 0.095 232)',
        4: 'oklch(0.46 0.14 258)',
        5: 'oklch(0.43 0.16 284)',
      },
      depthFog: 'oklch(0.88 0.012 235)',
      onDepth: 'oklch(1 0 0)',
      focus: 'oklch(0.51 0.095 232)',
      due: 'oklch(0.58 0.12 65)',
      dueInk: 'oklch(0.50 0.11 62)',
      correct: 'oklch(0.51 0.12 155)',
      incorrect: 'oklch(0.54 0.18 25)',
      viz: {
        seq: [
          'oklch(0.76 0.075 232)',
          'oklch(0.66 0.10 234)',
          'oklch(0.56 0.12 236)',
          'oklch(0.46 0.12 238)',
          'oklch(0.36 0.10 240)',
        ],
        div: { neg: 'oklch(0.58 0.12 65)', mid: 'oklch(0.86 0.008 240)', pos: 'oklch(0.50 0.11 236)' },
        ink: 'oklch(0.45 0.03 245)',
        ink2: 'oklch(0.52 0.025 245)',
      },
      syntax: {
        keyword: 'oklch(0.45 0.15 285)',
        string: 'oklch(0.47 0.10 155)',
        number: 'oklch(0.50 0.12 55)',
        function: 'oklch(0.45 0.10 240)',
        type: 'oklch(0.48 0.08 195)',
        comment: 'oklch(0.54 0.02 245)',
      },
    },
  },
  radius: { inline: 4, control: 6, panel: 10, popover: 12, modal: 16, pill: 999 },
  dur: { instant: 90, fast: 150, base: 220, exit: 160, moment: 720, reduced: 120 },
  space: [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72],
};

/** DS-01 §3.3 고대비(`data-contrast="more"`) 재정의 값. */
export const HIGH_CONTRAST: Record<
  ThemeMode,
  { fgMuted: string; fgSubtle: string; borderInput: string; borderStrong: string }
> = {
  dark: {
    fgMuted: 'oklch(0.85 0.014 235)',
    fgSubtle: 'oklch(0.76 0.018 240)',
    borderInput: 'oklch(0.64 0.026 245)',
    borderStrong: 'oklch(0.52 0.028 245)',
  },
  light: {
    fgMuted: 'oklch(0.36 0.03 245)',
    fgSubtle: 'oklch(0.42 0.028 245)',
    borderInput: 'oklch(0.52 0.02 235)',
    borderStrong: 'oklch(0.66 0.016 235)',
  },
};

export const EASE = {
  standard: [0.2, 0, 0, 1],
  exit: [0.4, 0, 1, 1],
  emphasized: [0.3, 0, 0, 1],
} as const;

export const FONT_STACK = {
  sans: '"Pretendard Variable", Pretendard, system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  display: '"Geist Variable", "Pretendard Variable", Pretendard, system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", "D2Coding", "Pretendard Variable", ui-monospace, monospace',
} as const;

const TEXT_BG = ['--bg', '--surface-1', '--surface-2', '--surface-3'] as const;
const SURFACES_3 = ['--bg', '--surface-1', '--surface-2'] as const;

function pairs(fgs: readonly string[], bgs: readonly string[], min: 3 | 4.5, role: string): ContrastPair[] {
  return fgs.flatMap((fg) => bgs.map((bg): ContrastPair => ({ fg, bg, min, role })));
}

/** DS-01 §3.4 대비 쌍 29개. fg·bg = CSS 변수 이름. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...pairs(['--fg', '--fg-muted', '--fg-subtle'], TEXT_BG, 4.5, 'text'),
  ...pairs(['--border-input'], SURFACES_3, 3, 'input-border'),
  ...pairs(['--focus'], TEXT_BG, 3, 'focus'),
  ...pairs(['--correct', '--incorrect', '--due-ink'], ['--surface-2'], 4.5, 'status'),
  ...pairs(['--on-depth'], ['--depth-1', '--depth-2', '--depth-3', '--depth-4', '--depth-5'], 4.5, 'depth-badge'),
  { fg: '--on-primary', bg: '--primary', min: 4.5, role: 'button' },
  { fg: '--on-danger', bg: '--danger', min: 4.5, role: 'button' },
];

/** DS-01 §3.4 "허용하지 않는 조합" — 실제로 기준 미달임을 테스트가 확인한다. */
export const FORBIDDEN_PAIRS: readonly { fg: string; bg: string; mode: ThemeMode | 'both'; min: 3 | 4.5 }[] = [
  { fg: '--depth-1', bg: '--bg', mode: 'light', min: 4.5 },
  { fg: '--due', bg: '--surface-2', mode: 'light', min: 4.5 },
  { fg: '--depth-5', bg: '--surface-2', mode: 'dark', min: 4.5 },
  { fg: '--depth-5', bg: '--surface-3', mode: 'dark', min: 4.5 },
  { fg: '--border-input', bg: '--surface-3', mode: 'both', min: 3 },
];

export function syntaxHex(
  mode: ThemeMode,
): Record<'keyword' | 'string' | 'number' | 'function' | 'type' | 'comment' | 'punct' | 'variable', string> {
  const c = TOKENS.color[mode];
  return {
    keyword: toHex(c.syntax.keyword),
    string: toHex(c.syntax.string),
    number: toHex(c.syntax.number),
    function: toHex(c.syntax.function),
    type: toHex(c.syntax.type),
    comment: toHex(c.syntax.comment),
    punct: toHex(c.fg.muted),
    variable: toHex(c.fg.base),
  };
}

export function vizTheme(mode: ThemeMode): {
  seq: string[];
  div: [string, string, string];
  status: { correct: string; partial: string; incorrect: string; pending: string };
  grid: string;
  axis: string;
} {
  const c = TOKENS.color[mode];
  return {
    seq: c.viz.seq.map((v) => toHex(v)),
    div: [toHex(c.viz.div.neg), toHex(c.viz.div.mid), toHex(c.viz.div.pos)],
    status: {
      correct: toHex(c.correct),
      partial: toHex(c.fg.muted),
      incorrect: toHex(c.incorrect),
      pending: toHex(c.border.strong),
    },
    grid: toHex(c.border.base),
    axis: toHex(c.fg.subtle),
  };
}

export function mermaidThemeVariables(mode: ThemeMode): Record<string, string> {
  const c = TOKENS.color[mode];
  const [s1, s2, s3] = c.surface;
  return {
    background: toHex(c.bg),
    primaryColor: toHex(s2),
    primaryTextColor: toHex(c.fg.base),
    primaryBorderColor: toHex(c.border.strong),
    secondaryColor: toHex(s3),
    tertiaryColor: toHex(s1),
    lineColor: toHex(c.border.strong),
    textColor: toHex(c.fg.base),
    mainBkg: toHex(s2),
    nodeBorder: toHex(c.border.strong),
    clusterBkg: toHex(s1),
    clusterBorder: toHex(c.border.base),
    titleColor: toHex(c.fg.base),
    edgeLabelBackground: toHex(s1),
    fontFamily: FONT_STACK.sans,
    fontSize: '15px',
  };
}

type ShikiTokenColor = { scope: string[]; settings: { foreground: string; fontStyle: '' } };
type ShikiTheme = {
  name: string;
  type: ThemeMode;
  colors: Record<string, string>;
  tokenColors: ShikiTokenColor[];
};

function shikiTheme(mode: ThemeMode): ShikiTheme {
  const hex = syntaxHex(mode);
  const c = TOKENS.color[mode];
  const entry = (scope: string[], foreground: string): ShikiTokenColor => ({
    scope,
    settings: { foreground, fontStyle: '' },
  });
  return {
    name: mode === 'dark' ? 'fathom-dark' : 'fathom-light',
    type: mode,
    colors: { 'editor.background': toHex(c.surface[1]), 'editor.foreground': toHex(c.fg.base) },
    tokenColors: [
      entry(['keyword', 'storage', 'storage.type', 'storage.modifier'], hex.keyword),
      entry(['string', 'string.quoted', 'string.template'], hex.string),
      entry(['constant.numeric', 'constant.language', 'constant.character'], hex.number),
      entry(['entity.name.function', 'support.function', 'meta.function-call'], hex.function),
      entry(['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], hex.type),
      entry(['comment', 'punctuation.definition.comment'], hex.comment),
      entry(['punctuation', 'meta.brace'], hex.punct),
      entry(['variable', 'variable.other', 'meta.definition.variable'], hex.variable),
    ],
  };
}

export const fathomShikiTheme: Record<ThemeMode, ShikiTheme> = {
  dark: shikiTheme('dark'),
  light: shikiTheme('light'),
};

function codeMirrorTheme(mode: ThemeMode): Record<string, Record<string, string>> {
  const c = TOKENS.color[mode];
  const s2 = toHex(c.surface[1]);
  const focus = toHex(c.focus);
  return {
    '&': { color: toHex(c.fg.base), backgroundColor: s2 },
    '.cm-content': { caretColor: focus, fontFamily: FONT_STACK.mono },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: focus },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: `${focus}47`,
    },
    '.cm-gutters': { backgroundColor: s2, color: toHex(c.fg.subtle), border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
  };
}

export const fathomCodeMirrorTheme: Record<ThemeMode, Record<string, Record<string, string>>> = {
  dark: codeMirrorTheme('dark'),
  light: codeMirrorTheme('light'),
};
