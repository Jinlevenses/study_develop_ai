import { describe, expect, it } from 'vitest';
import { EASE, HIGH_CONTRAST, TOKENS } from '../../../src/tokens.js';
import {
  blockBodies,
  declsOf,
  firstBlock,
  palette,
  rawPalette,
  readSrc,
  resolveVar,
  SEL,
  stripComments,
} from '../support/parse-tokens-css.js';
import { tokenVars } from '../support/token-vars.js';

const css = readSrc('tokens.css');
const themeBody = blockBodies(css, '@theme')[0] ?? '';
const theme = declsOf(themeBody);
const inlineBody = blockBodies(css, '@theme inline')[0] ?? '';
const inline = declsOf(inlineBody);

function resolvedBlock(selector: string): Record<string, string> {
  const raw = firstBlock(css, selector);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = resolveVar(v, raw);
  }
  return out;
}

describe('tokens.css 색', () => {
  it('UT-TOK-003 다크 블록 원시 값이 TOKENS.color.dark 전 필드와 같고 color-scheme: dark이다 [FR-UX-001]', () => {
    const body = blockBodies(css, SEL.dark)[0] ?? '';
    expect(body).toContain('color-scheme: dark;');
    const block = resolvedBlock(SEL.dark);
    const want = tokenVars('dark');
    expect(Object.keys(want).length).toBeGreaterThanOrEqual(36);
    for (const [name, value] of Object.entries(want)) {
      expect(block[name], name).toBe(value);
    }
    expect(firstBlock(css, SEL.dark)['--on-depth']).toBe('var(--bg)');
    expect(firstBlock(css, SEL.dark)['--due-ink']).toBe('var(--due)');
    expect(TOKENS.color.dark.viz.ink).toBe(TOKENS.color.dark.fg.muted);
    expect(TOKENS.color.dark.viz.ink2).toBe(TOKENS.color.dark.fg.subtle);
  });

  it('UT-TOK-004 라이트 블록이 TOKENS.color.light 전 필드와 같고 on-depth·on-primary는 흰색이다 [FR-UX-001]', () => {
    const body = blockBodies(css, SEL.light)[0] ?? '';
    expect(body).toContain('color-scheme: light;');
    const block = resolvedBlock(SEL.light);
    for (const [name, value] of Object.entries(tokenVars('light'))) {
      expect(block[name], name).toBe(value);
    }
    const raw = firstBlock(css, SEL.light);
    expect(raw['--on-depth']).toBe('oklch(1 0 0)');
    expect(raw['--on-primary']).toBe('oklch(1 0 0)');
    expect(raw['--due-ink']).toBe('oklch(0.50 0.11 62)');
    expect(raw['--due-ink']).not.toBe(raw['--due']);
  });

  it('UT-TOK-005 고대비 두 블록이 HIGH_CONTRAST와 같다 [NFR-UX-001]', () => {
    const dark = firstBlock(css, SEL.more);
    const light = firstBlock(css, SEL.lightMore);
    for (const [mode, block] of [
      ['dark', dark],
      ['light', light],
    ] as const) {
      const hc = HIGH_CONTRAST[mode];
      expect(block['--fg-muted']).toBe(hc.fgMuted);
      expect(block['--fg-subtle']).toBe(hc.fgSubtle);
      expect(block['--border-input']).toBe(hc.borderInput);
      expect(block['--border-strong']).toBe(hc.borderStrong);
      expect(Object.keys(block)).toHaveLength(4);
    }
  });
});

describe('tokens.css @theme', () => {
  it('UT-TOK-006 @theme 리셋 11줄·spacing·breakpoint가 있고 기본 팔레트 변수는 없다 [FR-UX-001]', () => {
    const resets = [
      'color',
      'font',
      'text',
      'radius',
      'shadow',
      'inset-shadow',
      'drop-shadow',
      'blur',
      'ease',
      'animate',
      'breakpoint',
    ];
    for (const r of resets) {
      expect(themeBody, r).toContain(`--${r}-*: initial;`);
    }
    expect(theme['--spacing']).toBe('0.25rem');
    expect(theme['--breakpoint-sm']).toBe('22.5rem');
    expect(theme['--breakpoint-md']).toBe('48rem');
    expect(theme['--breakpoint-lg']).toBe('80rem');
    expect(theme['--breakpoint-xl']).toBe('90rem');
    const names =
      /--color-(red|blue|slate|gray|zinc|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|stone|neutral)-\d/;
    expect(stripComments(css)).not.toMatch(names);
  });

  it('UT-TOK-007 @theme inline의 모든 --color-x가 dark·light 팔레트에서 해석되고 그림자·본문 크기가 연결된다 [FR-UX-001]', () => {
    const pals = [palette(css, { mode: 'dark' }), palette(css, { mode: 'light' })];
    const raws = [rawPalette(css, { mode: 'dark' }), rawPalette(css, { mode: 'light' })];
    const colorEntries = Object.entries(inline).filter(([k]) => k.startsWith('--color-'));
    expect(colorEntries.length).toBeGreaterThanOrEqual(50);
    for (const [name, value] of colorEntries) {
      const m = /^var\((--[\w-]+)\)$/.exec(value);
      expect(m, name).not.toBeNull();
      const ref = m?.[1] ?? '';
      expect(ref, name).toBe(`--${name.slice('--color-'.length)}`);
      for (const [i, raw] of raws.entries()) {
        expect(raw[ref], `${name} -> ${ref}`).toBeDefined();
        expect(pals[i]?.[ref], `${name} resolved`).toBeDefined();
      }
    }
    expect(inline['--shadow-panel']).toBe('var(--elev-panel)');
    expect(inline['--shadow-popover']).toBe('var(--elev-popover)');
    expect(inline['--shadow-modal']).toBe('var(--elev-modal)');
    expect(inline['--text-body']).toBe('var(--body-size)');
  });
});

describe('tokens.css 파생·밀도·모션·기타', () => {
  it('UT-TOK-008 파생 블록 17개 선언의 이름·식이 DS-01 §14 4절과 같다 [FR-UX-001]', () => {
    const derived = firstBlock(css, ':root', '--state-hover');
    const want: Record<string, string> = {
      '--state-hover': 'color-mix(in oklch, var(--fg) 6%, transparent)',
      '--state-press': 'color-mix(in oklch, var(--fg) 10%, transparent)',
      '--state-selected': 'var(--surface-3)',
      '--correct-wash': 'color-mix(in oklch, var(--correct) 12%, var(--surface-2))',
      '--incorrect-wash': 'color-mix(in oklch, var(--incorrect) 12%, var(--surface-2))',
      '--due-wash': 'color-mix(in oklch, var(--due) 12%, var(--surface-2))',
      '--focus-wash': 'color-mix(in oklch, var(--focus) 8%, transparent)',
      '--selection': 'color-mix(in oklch, var(--focus) 28%, transparent)',
      '--viz-ink': 'var(--fg-muted)',
      '--viz-ink-2': 'var(--fg-subtle)',
      '--viz-pending': 'var(--border-strong)',
      '--viz-hatch': 'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 6px)',
    };
    for (const n of [1, 2, 3, 4, 5]) {
      want[`--depth-${n}-wash`] = `color-mix(in oklch, var(--depth-${n}) 8%, var(--bg))`;
    }
    expect(Object.keys(derived).sort()).toEqual(Object.keys(want).sort());
    expect(Object.keys(derived)).toHaveLength(17);
    for (const [k, v] of Object.entries(want)) {
      expect(derived[k], k).toBe(v);
    }
  });

  it('UT-TOK-009 밀도 블록 comfortable·compact가 DS-01 §5.3과 같다 [FR-UX-001]', () => {
    const comfortable = firstBlock(css, ':root,\n[data-density="comfortable"]');
    const compact = firstBlock(css, '[data-density="compact"]');
    expect(comfortable).toMatchObject({
      '--row-h': '36px',
      '--control-h': '36px',
      '--control-px': '12px',
      '--panel-p': '20px',
      '--kbd-hints': 'block',
    });
    expect(compact).toMatchObject({
      '--row-h': '28px',
      '--control-h': '30px',
      '--control-px': '10px',
      '--panel-p': '16px',
      '--kbd-hints': 'none',
    });
  });

  it('UT-TOK-010 모션 토큰·reduce 두 곳·easing이 TOKENS.dur·EASE와 같다 [FR-UX-009]', () => {
    const root = firstBlock(css, ':root', '--dur-instant');
    for (const kind of ['instant', 'fast', 'base', 'exit', 'moment', 'reduced'] as const) {
      expect(root[`--dur-${kind}`], kind).toBe(`${TOKENS.dur[kind]}ms`);
    }
    const zero = ['instant', 'fast', 'base', 'exit', 'moment'];
    const attr = firstBlock(css, '[data-motion="reduce"]');
    const media = blockBodies(css, '@media (prefers-reduced-motion: reduce)')[0] ?? '';
    const mediaDecls = declsOf(media);
    expect(media).toContain(':root:not([data-motion="full"])');
    for (const k of zero) {
      expect(attr[`--dur-${k}`], `attr ${k}`).toBe('0ms');
      expect(mediaDecls[`--dur-${k}`], `media ${k}`).toBe('0ms');
    }
    const over = Object.entries(root).filter(
      ([k, v]) => k.startsWith('--dur-') && k !== '--dur-moment' && Number.parseInt(v, 10) > 250,
    );
    expect(over).toEqual([]);
    for (const name of ['standard', 'exit', 'emphasized'] as const) {
      expect(theme[`--ease-${name}`], name).toBe(`cubic-bezier(${EASE[name].join(', ')})`);
    }
  });

  it('UT-TOK-011 반경·z-index·레이아웃 토큰이 DS-01 §5.2·§6과 같다 [FR-UX-001]', () => {
    for (const [name, px] of Object.entries(TOKENS.radius)) {
      expect(theme[`--radius-${name}`], name).toBe(`${px}px`);
    }
    const root = firstBlock(css, ':root', '--z-base');
    const z = {
      base: 0,
      sticky: 10,
      rail: 20,
      drawer: 30,
      popover: 40,
      modal: 50,
      palette: 60,
      toast: 70,
      'overlay-system': 80,
    };
    for (const [name, v] of Object.entries(z)) {
      expect(root[`--z-${name}`], name).toBe(String(v));
    }
    expect(Object.keys(root).filter((k) => k.startsWith('--z-'))).toHaveLength(9);
    expect(root).toMatchObject({
      '--shell-header-h': '48px',
      '--shell-header-h-focus': '40px',
      '--shell-rail-w': '56px',
      '--shell-rail-w-wide': '200px',
      '--shell-context-w': '320px',
      '--measure-read': '68ch',
      '--measure-ui': '72ch',
      '--content-max': '1200px',
    });
  });

  it('UT-TOK-012 타입 스케일 10단이 DS-01 §4.2와 같다 [NFR-UX-009]', () => {
    const scale: Record<string, [string, string, string | undefined, string | undefined]> = {
      '2xs': ['0.6875rem', '1rem', '0.01em', '500'],
      xs: ['0.78125rem', '1.125rem', undefined, '450'],
      sm: ['0.84375rem', '1.25rem', undefined, '450'],
      base: ['0.9375rem', '1.5rem', undefined, '400'],
      read: ['1.0625rem', '1.7', '-0.005em', undefined],
      lg: ['1.125rem', '1.625rem', '-0.01em', '600'],
      xl: ['1.375rem', '1.3', '-0.01em', '650'],
      '2xl': ['1.6875rem', '1.3', '-0.01em', '700'],
      '3xl': ['2.125rem', '1.3', '-0.01em', '700'],
      display: ['2.75rem', '1.1', '-0.02em', '600'],
    };
    expect(Object.keys(scale)).toHaveLength(10);
    for (const [name, [size, lh, ls, weight]] of Object.entries(scale)) {
      expect(theme[`--text-${name}`], `${name} size`).toBe(size);
      expect(theme[`--text-${name}--line-height`], `${name} lh`).toBe(lh);
      expect(theme[`--text-${name}--letter-spacing`], `${name} ls`).toBe(ls);
      expect(theme[`--text-${name}--font-weight`], `${name} weight`).toBe(weight);
    }
    expect(theme['--text-read--line-height']).toBe('1.7');
  });

  it('UT-TOK-018 @custom-variant 4개·oklch 리터럴 위치·TOKENS.space를 검증한다 [FR-UX-001]', () => {
    const src = stripComments(css);
    for (const name of ['dark', 'light', 'compact', 'motion-reduce-app']) {
      expect(src, name).toContain(`@custom-variant ${name} (`);
    }
    expect(src.match(/@custom-variant /g)).toHaveLength(4);
    let rest = src;
    for (const sel of [SEL.dark, SEL.light, SEL.more, SEL.lightMore]) {
      for (const body of blockBodies(rest, sel)) {
        rest = rest.replace(body, '');
      }
    }
    expect(rest).not.toMatch(/oklch\(/);
    expect(src).toMatch(/oklch\(/);
    expect([...TOKENS.space]).toEqual([2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56, 72]);
  });
});
