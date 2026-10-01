import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance, toHex } from '../../../src/color.js';
import {
  CONTRAST_PAIRS,
  FONT_STACK,
  FORBIDDEN_PAIRS,
  fathomCodeMirrorTheme,
  fathomShikiTheme,
  mermaidThemeVariables,
  syntaxHex,
  type ThemeMode,
  TOKENS,
  vizTheme,
} from '../../../src/tokens.js';
import { palette, readSrc } from '../support/parse-tokens-css.js';

const css = readSrc('tokens.css');
const MODES: readonly ThemeMode[] = ['dark', 'light'];
const HEX6 = /^#[0-9a-f]{6}$/;

describe('tokens.ts 도출 상수', () => {
  it('UT-TOK-015 vizTheme: 전 값 hex6·seq 휘도 단조·status·grid·axis [FR-UX-001]', () => {
    for (const mode of MODES) {
      const v = vizTheme(mode);
      const c = TOKENS.color[mode];
      const all = [
        ...v.seq,
        ...v.div,
        v.status.correct,
        v.status.partial,
        v.status.incorrect,
        v.status.pending,
        v.grid,
        v.axis,
      ];
      for (const h of all) {
        expect(h, `${mode} ${h}`).toMatch(HEX6);
      }
      expect(v.seq).toHaveLength(5);
      const lum = c.viz.seq.map((s) => relativeLuminance(s));
      for (let i = 1; i < lum.length; i += 1) {
        const prev = lum[i - 1] ?? 0;
        const cur = lum[i] ?? 0;
        expect(mode === 'dark' ? cur > prev : cur < prev, `${mode} seq ${i}`).toBe(true);
      }
      expect(v.status.partial).toBe(toHex(c.fg.muted));
      expect(v.status.pending).toBe(toHex(c.border.strong));
      expect(v.status.correct).toBe(toHex(c.correct));
      expect(v.status.incorrect).toBe(toHex(c.incorrect));
      expect(v.grid).toBe(toHex(c.border.base));
      expect(v.axis).toBe(toHex(c.fg.subtle));
      expect(v.div).toEqual([toHex(c.viz.div.neg), toHex(c.viz.div.mid), toHex(c.viz.div.pos)]);
    }
  });

  it('UT-TOK-016 mermaidThemeVariables: 키 16개·색 키 hex·주요 값 매핑 [FR-UX-001]', () => {
    const keys = [
      'background',
      'primaryColor',
      'primaryTextColor',
      'primaryBorderColor',
      'secondaryColor',
      'tertiaryColor',
      'lineColor',
      'textColor',
      'mainBkg',
      'nodeBorder',
      'clusterBkg',
      'clusterBorder',
      'titleColor',
      'edgeLabelBackground',
      'fontFamily',
      'fontSize',
    ];
    for (const mode of MODES) {
      const m = mermaidThemeVariables(mode);
      const c = TOKENS.color[mode];
      expect(Object.keys(m).sort()).toEqual([...keys].sort());
      for (const k of keys.filter((n) => n !== 'fontFamily' && n !== 'fontSize')) {
        expect(m[k], k).toMatch(HEX6);
      }
      expect(m.textColor).toBe(toHex(c.fg.base));
      expect(m.primaryColor).toBe(toHex(c.surface[1]));
      expect(m.lineColor).toBe(toHex(c.border.strong));
      expect(m.background).toBe(toHex(c.bg));
      expect(m.fontFamily).toBe(FONT_STACK.sans);
      expect(m.fontSize).toBe('15px');
    }
  });

  it('UT-TOK-017 shiki 테마(8항목·italic 0)·CodeMirror 테마 6키·syntaxHex 8키 [FR-UX-001][NFR-UX-009]', () => {
    for (const mode of MODES) {
      const t = fathomShikiTheme[mode];
      const c = TOKENS.color[mode];
      expect(t.name).toBe(mode === 'dark' ? 'fathom-dark' : 'fathom-light');
      expect(t.type).toBe(mode);
      expect(t.colors['editor.background']).toBe(toHex(c.surface[1]));
      expect(t.colors['editor.foreground']).toBe(toHex(c.fg.base));
      expect(t.tokenColors).toHaveLength(8);
      for (const tc of t.tokenColors) {
        expect(tc.settings.fontStyle).toBe('');
        expect(tc.settings.foreground).toMatch(HEX6);
      }
      const comment = t.tokenColors.find((tc) => tc.scope.includes('comment'));
      expect(comment?.settings.foreground).toBe(toHex(c.syntax.comment));
      expect(JSON.stringify(t)).not.toContain('italic');

      const cm = fathomCodeMirrorTheme[mode];
      expect(Object.keys(cm)).toHaveLength(6);
      expect(cm['&']).toEqual({ color: toHex(c.fg.base), backgroundColor: toHex(c.surface[1]) });
      expect(cm['.cm-content']?.fontFamily).toBe(FONT_STACK.mono);
      const sel = cm['&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection'];
      expect(sel?.backgroundColor).toBe(`${toHex(c.focus)}47`);
      expect(cm['.cm-activeLine']).toEqual({ backgroundColor: 'transparent' });

      const syn = syntaxHex(mode);
      expect(Object.keys(syn).sort()).toEqual([
        'comment',
        'function',
        'keyword',
        'number',
        'punct',
        'string',
        'type',
        'variable',
      ]);
      expect(syn.punct).toBe(toHex(c.fg.muted));
      expect(syn.variable).toBe(toHex(c.fg.base));
    }
  });

  it('UT-TOK-019 CONTRAST_PAIRS 29개·중복 0·FORBIDDEN_PAIRS 교집합 0·금지 조합은 실제 기준 미달이다 [NFR-UX-001]', () => {
    expect(CONTRAST_PAIRS).toHaveLength(29);
    const keys = CONTRAST_PAIRS.map((p) => `${p.fg}|${p.bg}`);
    expect(new Set(keys).size).toBe(29);
    const forbidden = new Set(FORBIDDEN_PAIRS.map((p) => `${p.fg}|${p.bg}`));
    expect(FORBIDDEN_PAIRS).toHaveLength(5);
    for (const k of keys) {
      expect(forbidden.has(k), k).toBe(false);
    }
    const dark = palette(css, { mode: 'dark' });
    const light = palette(css, { mode: 'light' });
    const measured: number[] = [];
    for (const f of FORBIDDEN_PAIRS) {
      const targets = f.mode === 'both' ? [dark, light] : [f.mode === 'dark' ? dark : light];
      for (const p of targets) {
        const fg = p[f.fg];
        const bg = p[f.bg];
        expect(fg).toBeDefined();
        expect(bg).toBeDefined();
        const r = contrastRatio(fg ?? '', bg ?? '');
        expect(r, `${f.mode} ${f.fg}/${f.bg}`).toBeLessThan(f.min);
        measured.push(Number(r.toFixed(2)));
      }
    }
    for (const want of [4.44, 3.96, 4.26, 3.74, 2.93, 2.77]) {
      expect(
        measured.some((m) => Math.abs(m - want) <= 0.01),
        String(want),
      ).toBe(true);
    }
  });
});
