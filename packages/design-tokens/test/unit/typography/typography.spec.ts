import { describe, expect, it } from 'vitest';
import { FONT_STACK } from '../../../src/tokens.js';
import { blockBodies, declsOf, readSrc, stripComments } from '../support/parse-tokens-css.js';

const css = readSrc('tokens.css');
const typo = stripComments(readSrc('typography.css'));
const theme = declsOf(blockBodies(css, '@theme')[0] ?? '');

describe('typography.css', () => {
  it('UT-TOK-013 폰트 스택이 FONT_STACK과 같고 D2Coding이 JetBrains Mono 바로 뒤이며 외부 URL이 없다 [FR-UX-013]', () => {
    expect(theme['--font-sans']).toBe(FONT_STACK.sans);
    expect(theme['--font-display']).toBe(FONT_STACK.display);
    expect(theme['--font-mono']).toBe(FONT_STACK.mono);
    const mono = theme['--font-mono'] ?? '';
    expect(mono.indexOf('"D2Coding"')).toBe(
      mono.indexOf('"JetBrains Mono Variable"') + '"JetBrains Mono Variable", '.length,
    );
    for (const text of [css, typo]) {
      expect(text).not.toContain('http');
      expect(text).not.toMatch(/@import\s+url\(/);
      expect(text).not.toContain('@font-face');
    }
  });

  it('UT-TOK-014 한국어 조판 규칙·전역 포커스 링이 있고 이탤릭·대문자·원색 리터럴은 없다 [NFR-UX-009]', () => {
    expect(typo).toContain('word-break: keep-all;');
    expect(typo).toContain('overflow-wrap: anywhere;');
    expect(typo).toMatch(/h1, h2, h3, h4 \{[^}]*text-wrap: balance;/);
    expect(typo).toMatch(/body \{[^}]*text-wrap: pretty;/);
    expect(typo).toMatch(/em, i, cite, dfn \{ font-style: normal; font-weight: 600; \}/);
    expect(typo).toContain('font-variant-numeric: tabular-nums;');
    expect(typo).toContain('td[data-numeric]');
    expect(typo).toMatch(/:focus-visible \{ outline: 2px solid var\(--focus\)/);
    expect(typo).toContain('outline-offset: 2px');
    expect(typo).not.toMatch(/font-style:\s*italic/);
    expect(typo).not.toMatch(/uppercase/);
    expect(typo).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|hwb)\(/);
  });
});
