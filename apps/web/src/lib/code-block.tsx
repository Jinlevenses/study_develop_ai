import { fathomShikiTheme } from '@fathom/design-tokens/tokens';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { HighlighterCore, LanguageRegistration } from 'shiki/core';
import { useDocTheme } from './theme.js';

export type CodeLang = 'ts' | 'js' | 'sql' | 'yaml' | 'json' | 'bash' | 'dockerfile' | 'text';

export interface TokenLike {
  readonly content: string;
  readonly color?: string;
}
export type TokenLines = readonly (readonly TokenLike[])[];

type HighlightLang = Exclude<CodeLang, 'text'>;

// 리터럴 동적 import 표 — `import(변수)` 금지(STD-TS-12). 언어마다 지연 청크가 된다(STD-WEB-40).
const LANG_LOADERS: Readonly<Record<HighlightLang, () => Promise<{ readonly default: LanguageRegistration[] }>>> = {
  ts: () => import('shiki/langs/typescript.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
};

const SHIKI_LANG: Readonly<Record<HighlightLang, string>> = {
  ts: 'typescript',
  js: 'javascript',
  sql: 'sql',
  yaml: 'yaml',
  json: 'json',
  bash: 'bash',
  dockerfile: 'dockerfile',
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<HighlightLang>();

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = (async () => {
      const { createHighlighterCore } = await import('shiki/core');
      const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
      return createHighlighterCore({
        themes: [fathomShikiTheme.dark, fathomShikiTheme.light],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

/** 지연 하이라이트. 로딩 실패·미지원이면 null(호출 측은 평문을 유지한다). */
async function highlight(code: string, lang: HighlightLang, mode: 'dark' | 'light'): Promise<TokenLines | null> {
  try {
    const hl = await getHighlighter();
    if (!loadedLangs.has(lang)) {
      await hl.loadLanguage(LANG_LOADERS[lang]);
      loadedLangs.add(lang);
    }
    const { tokens } = hl.codeToTokens(code, { lang: SHIKI_LANG[lang], theme: fathomShikiTheme[mode].name });
    return tokens;
  } catch {
    // 하이라이터 로딩 실패 — 평문 렌더를 유지한다.
    highlighterPromise = null;
    return null;
  }
}

/** 토큰 → span·style color(HTML 문자열 삽입 0). */
export function tokensToElements(lines: TokenLines): ReactNode {
  return lines.map((tokens, li) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 코드 줄은 순서가 곧 정체성이다
    <span key={li}>
      {tokens.map((t, ti) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 토큰은 줄 안의 순서가 곧 정체성이다
        <span key={ti} style={t.color === undefined ? undefined : { color: t.color }}>
          {t.content}
        </span>
      ))}
      {li < lines.length - 1 ? '\n' : null}
    </span>
  ));
}

export interface CodeBlockProps {
  readonly code: string;
  readonly lang: CodeLang;
  readonly caption?: string;
}

export function CodeBlock({ code, lang, caption }: CodeBlockProps): ReactElement {
  const mode = useDocTheme();
  const [lines, setLines] = useState<TokenLines | null>(null);
  useEffect(() => {
    if (lang === 'text') {
      setLines(null);
      return;
    }
    let cancelled = false;
    void highlight(code, lang, mode).then((r) => {
      if (!cancelled) {
        setLines(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, mode]);
  const block = (
    <pre className="overflow-x-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-sm text-fg">
      <code data-lang={lang}>{lines === null ? code : tokensToElements(lines)}</code>
    </pre>
  );
  if (caption === undefined) {
    return block;
  }
  return (
    <figure>
      {block}
      <figcaption className="mt-1 text-xs text-fg-muted">{caption}</figcaption>
    </figure>
  );
}
