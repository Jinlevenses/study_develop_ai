import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeMarkdown } from '../../../src/lib/markdown.js';
import { MERMAID_CONFIG } from '../../../src/lib/mermaid-figure.js';
import { mountSvg } from '../../../src/lib/svg-mount.js';

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(() => Promise.reject(new Error('mocked highlighter'))),
}));

afterEach(cleanup);

const SRC_ROOT = join(import.meta.dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

describe('safety', () => {
  it('UT-WEB-202 원시 HTML은 텍스트·DOM 모두 실행·생성되지 않고 mermaid는 strict이며 svg-mount 위험 요소 0, src 텍스트에 위험 API가 0이다 [FR-UX-014][NFR-SEC-009]', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    try {
      const md = [
        '<img src=x onerror=alert(1)>',
        '',
        '<script>alert(1)</script>',
        '',
        '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
        '',
        '안전한 글',
      ].join('\n');
      const { container } = render(<SafeMarkdown markdown={md} variant="read" />);
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[onerror], [onclick]')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toContain('안전한 글');
      expect(container.textContent).not.toContain('<script>');
      expect(alert).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(MERMAID_CONFIG.securityLevel).toBe('strict');
    expect(MERMAID_CONFIG.htmlLabels).toBe(false);

    const host = document.createElement('div');
    mountSvg(
      host,
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>x()</script><foreignObject/><a href="javascript:x()"/></svg>',
    );
    expect(host.querySelector('script, foreignObject')).toBeNull();
    expect(host.querySelector('[onload]')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBeNull();

    const banned = ['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'];
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const needle of banned) {
        if (text.includes(needle)) {
          offenders.push(`${relative(SRC_ROOT, file)}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
