import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeMarkdown, transformUrl } from '../../../src/lib/markdown.js';

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() => Promise.reject(new Error('mocked highlighter'))),
}));

afterEach(cleanup);

const SOURCE = [
  '[js](javascript:alert(1)) [data](data:text/html,x) [ext](https://example.com/a) [conc](concept:k8s.probes) [bad](concept:NOT_AN_ID)',
  '',
  '![remote](https://evil.example/x.png) ![local](/img/a.png) ![proto](//evil.example/x.png)',
  '',
  '```ts',
  'const a: number = 1;',
  '```',
  '',
  '인라인 `code` 입니다.',
].join('\n');

describe('markdown', () => {
  it('UT-WEB-038 SafeMarkdown은 javascript:·data: 링크를 무력화하고 외부 링크에 rel·target을 붙이며 원격 이미지는 alt 텍스트, concept:는 /concepts/로 바꾸고 코드 펜스는 CodeBlock이다 [FR-UX-014][NFR-SEC-009]', () => {
    const { container } = render(<SafeMarkdown markdown={SOURCE} variant="read" />);
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a', '/concepts/k8s.probes']);
    const ext = anchors[0];
    expect(ext?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(ext?.getAttribute('target')).toBe('_blank');
    expect(ext?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(anchors[1]?.getAttribute('target')).toBeNull();
    expect(container.textContent).toContain('js');
    expect(container.textContent).toContain('data');
    expect(container.textContent).toContain('bad');
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/img/a.png']);
    expect(imgs[0]?.getAttribute('loading')).toBe('lazy');
    expect(container.textContent).toContain('remote');
    expect(container.textContent).toContain('proto');
    expect(container.querySelector('code[data-lang="ts"]')?.textContent).toContain('const a: number = 1;');
    expect(container.querySelector('pre pre')).toBeNull();
    expect(container.querySelector('p code')?.getAttribute('data-lang')).toBeNull();
    expect(container.firstElementChild?.className).toContain('max-w-(--measure-read)');
    const ui = render(<SafeMarkdown markdown="안녕" variant="ui" />);
    expect(ui.container.firstElementChild?.className).toBe('text-sm');

    expect(transformUrl('https://a.example')).toBe('https://a.example');
    expect(transformUrl('/concepts/x')).toBe('/concepts/x');
    expect(transformUrl('#frag')).toBe('#frag');
    expect(transformUrl('//evil.example')).toBe('');
    expect(transformUrl('javascript:alert(1)')).toBe('');
    expect(transformUrl('data:text/html,x')).toBe('');
    expect(transformUrl('concept:k8s.probes')).toBe('/concepts/k8s.probes');
    expect(transformUrl('concept:../../x')).toBe('');
    expect(transformUrl('mailto:a@b.c')).toBe('');
  });
});
