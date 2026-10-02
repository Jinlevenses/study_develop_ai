import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock, tokensToElements } from '../../../src/lib/code-block.js';

const created = vi.hoisted(() => ({ count: 0 }));

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() => {
    created.count += 1;
    return Promise.resolve({
      loadLanguage: vi.fn(() => Promise.resolve()),
      codeToTokens: vi.fn(() => ({
        tokens: [[{ content: 'const', color: 'tomato' }, { content: ' x' }], [{ content: '<script>', color: 'teal' }]],
      })),
    });
  }),
}));

afterEach(cleanup);

describe('code-block', () => {
  it('UT-WEB-039 CodeBlock lang=text는 평문(shiki 로드 0)이고 tokensToElements는 span·style color로 렌더하며 HTML 문자열을 만들지 않는다 [FR-UX-014]', async () => {
    const plain = render(<CodeBlock code={'a\nb'} lang="text" caption="설명" />);
    expect(plain.container.querySelector('code')?.textContent).toBe('a\nb');
    expect(plain.container.querySelector('figcaption')?.textContent).toBe('설명');
    await Promise.resolve();
    expect(created.count).toBe(0);
    plain.unmount();

    const hl = render(<CodeBlock code="const x" lang="ts" />);
    expect(hl.container.querySelector('code')?.textContent).toBe('const x'); // 첫 렌더 = 평문
    await waitFor(() => expect(hl.container.querySelectorAll('code span[style]').length).toBeGreaterThan(0));
    expect(created.count).toBe(1);
    const spans = [...hl.container.querySelectorAll('code span[style]')];
    expect(spans.map((s) => s.textContent)).toEqual(['const', '<script>']);
    expect(spans[0]?.getAttribute('style')).toContain('color: tomato');
    expect(hl.container.querySelector('script')).toBeNull();
    expect(hl.container.querySelector('code')?.textContent).toBe('const x\n<script>');
    hl.unmount();

    const direct = render(<pre>{tokensToElements([[{ content: '<b>x</b>', color: 'red' }]])}</pre>);
    expect(direct.container.querySelector('b')).toBeNull();
    expect(direct.container.textContent).toBe('<b>x</b>');
    expect(direct.container.querySelector('span span')?.getAttribute('style')).toContain('color: red');
  });
});
