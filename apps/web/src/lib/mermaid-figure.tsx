import { mermaidThemeVariables } from '@fathom/design-tokens/tokens';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { mountSvg } from './svg-mount.js';
import { useDocTheme } from './theme.js';

/** `htmlLabels: false` = `foreignObject` 미사용 → svg-mount sanitize와 호환(Brief 결정). */
export function mermaidConfig(mode: 'dark' | 'light') {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    themeVariables: mermaidThemeVariables(mode),
  } as const;
}

export const MERMAID_CONFIG = mermaidConfig('dark');

export interface MermaidFigureProps {
  readonly code: string;
  readonly altKo: string;
  readonly id: string;
}

export function MermaidFigure({ code, altKo, id }: MermaidFigureProps): ReactElement {
  if (altKo === '') {
    throw new TypeError('MermaidFigure는 altKo(한국어 대체 설명)가 필수입니다');
  }
  const mode = useDocTheme();
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const captionId = `${id}-caption`;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize(mermaidConfig(mode));
        const { svg } = await mermaid.render(id, code);
        if (cancelled) {
          return;
        }
        setFailed(host.current === null || !mountSvg(host.current, svg));
      } catch {
        // 렌더 실패 — 원문 코드와 캡션을 그대로 보여 준다.
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id, mode]);
  return (
    <figure aria-describedby={captionId}>
      <div ref={host} />
      {failed ? (
        <pre className="overflow-x-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-sm text-fg">
          <code>{code}</code>
        </pre>
      ) : null}
      <figcaption id={captionId} className="mt-1 text-sm text-fg-muted">
        {altKo}
      </figcaption>
    </figure>
  );
}
