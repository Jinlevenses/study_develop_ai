import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../../src/color.js';
import { CONTRAST_PAIRS } from '../../../src/tokens.js';
import { palette, readSrc } from '../support/parse-tokens-css.js';

const css = readSrc('tokens.css');
const PALETTES = [
  { name: 'dark', mode: 'dark', more: false },
  { name: 'light', mode: 'light', more: false },
  { name: 'dark+more', mode: 'dark', more: true },
  { name: 'light+more', mode: 'light', more: true },
] as const;

function ratio(p: Record<string, string>, fg: string, bg: string): number {
  const f = p[fg];
  const b = p[bg];
  if (f === undefined || b === undefined) {
    throw new Error(`토큰 없음: ${fg} / ${bg}`);
  }
  return contrastRatio(f, b);
}

function minOf(mode: 'dark' | 'light', pred: (p: { fg: string; role: string }) => boolean): number {
  const p = palette(css, { mode });
  return Math.min(...CONTRAST_PAIRS.filter(pred).map((c) => ratio(p, c.fg, c.bg)));
}

describe('contrast', () => {
  it('UT-TOK-001 4팔레트 x CONTRAST_PAIRS 29쌍(116건) 전부 최소 대비 이상이다 [NFR-UX-001][FR-UX-001]', () => {
    expect(CONTRAST_PAIRS).toHaveLength(29);
    let checked = 0;
    for (const pal of PALETTES) {
      const p = palette(css, pal);
      for (const pair of CONTRAST_PAIRS) {
        const r = ratio(p, pair.fg, pair.bg);
        expect(r, `${pal.name} ${pair.fg}/${pair.bg}`).toBeGreaterThanOrEqual(pair.min);
        checked += 1;
      }
    }
    expect(checked).toBe(116);
  });

  it('UT-TOK-001 표준 팔레트 역할별 최저값이 DS-01 §3.4와 +-0.01 일치한다 [NFR-UX-001][FR-UX-001]', () => {
    const want: [string, (p: { fg: string; role: string }) => boolean, number, number][] = [
      ['text', (p) => p.role === 'text', 4.56, 4.54],
      ['input-border', (p) => p.role === 'input-border', 3.35, 3.01],
      ['focus', (p) => p.role === 'focus', 8.12, 4.66],
      ['status', (p) => p.role === 'status', 5.83, 4.86],
      ['depth-badge', (p) => p.role === 'depth-badge', 4.97, 4.63],
      ['button-primary', (p) => p.fg === '--on-primary', 15.88, 16.87],
      ['button-danger', (p) => p.fg === '--on-danger', 6.8, 5.55],
    ];
    for (const [name, pred, dark, light] of want) {
      expect(Math.abs(minOf('dark', pred) - dark), `dark ${name}`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(minOf('light', pred) - light), `light ${name}`).toBeLessThanOrEqual(0.01);
    }
  });
});
