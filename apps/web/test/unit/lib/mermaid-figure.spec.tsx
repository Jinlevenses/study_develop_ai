import { cleanup, render, waitFor } from '@testing-library/react';
import mermaid from 'mermaid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MERMAID_CONFIG, MermaidFigure, mermaidConfig } from '../../../src/lib/mermaid-figure.js';

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

afterEach(cleanup);

describe('mermaid-figure', () => {
  it('UT-WEB-041 MERMAID_CONFIG는 strict·htmlLabels false·startOnLoad false이고 render 실패는 원문 코드+figcaption·aria-describedby, altKo 빈 문자열은 TypeError다 [FR-UX-014][NFR-SEC-009]', async () => {
    expect(MERMAID_CONFIG.securityLevel).toBe('strict');
    expect(MERMAID_CONFIG.startOnLoad).toBe(false);
    expect(MERMAID_CONFIG.htmlLabels).toBe(false);
    expect(MERMAID_CONFIG.flowchart.htmlLabels).toBe(false);
    expect(MERMAID_CONFIG.theme).toBe('base');
    expect(mermaidConfig('light').themeVariables).not.toEqual(mermaidConfig('dark').themeVariables);

    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('syntax'));
    const bad = render(<MermaidFigure code={'graph TD; A-->B'} altKo="A에서 B로 이어지는 흐름" id="m1" />);
    await waitFor(() => expect(bad.container.querySelector('pre code')?.textContent).toBe('graph TD; A-->B'));
    const figure = bad.container.querySelector('figure');
    const caption = bad.container.querySelector('figcaption');
    expect(caption?.textContent).toBe('A에서 B로 이어지는 흐름');
    expect(figure?.getAttribute('aria-describedby')).toBe(caption?.getAttribute('id'));
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
    );
    bad.unmount();

    vi.mocked(mermaid.render).mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><g id="ok"/></svg>',
      bindFunctions: undefined,
      diagramType: 'flowchart',
    });
    const good = render(<MermaidFigure code="graph TD; A-->B" altKo="흐름" id="m2" />);
    await waitFor(() => expect(good.container.querySelector('#ok')).not.toBeNull());
    expect(good.container.querySelector('script')).toBeNull();
    expect(good.container.querySelector('pre')).toBeNull();
    good.unmount();

    expect(() => render(<MermaidFigure code="graph TD" altKo="" id="m3" />)).toThrow(TypeError);
  });
});
