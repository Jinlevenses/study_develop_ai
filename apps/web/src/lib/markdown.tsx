import { ConceptId } from '@fathom/contracts/common/ids';
import { iconProps } from '@fathom/ui/lib/icon';
import { ExternalLink } from 'lucide-react';
import type { ReactElement } from 'react';
import Markdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { CodeBlock, type CodeLang } from './code-block.js';

export interface SafeMarkdownProps {
  readonly markdown: string;
  readonly variant: 'read' | 'ui';
}

// 기본 스키마 + `concept:` 프로토콜(내부 개념 링크) — `rehype-raw`는 쓰지 않는다.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'concept'],
  },
};

const CODE_LANG: Readonly<Record<string, CodeLang>> = {
  ts: 'ts',
  typescript: 'ts',
  js: 'js',
  javascript: 'js',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  dockerfile: 'dockerfile',
};

const CONCEPT_PREFIX = 'concept:';

/** http(s)·내부 경로·`#`·`concept:<id>`만 통과, 그 밖(javascript:·data: 등)은 빈 문자열로 무력화한다. */
export function transformUrl(url: string): string {
  if (/^https?:/i.test(url)) {
    return url;
  }
  if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//'))) {
    return url;
  }
  if (url.startsWith(CONCEPT_PREFIX)) {
    const id = url.slice(CONCEPT_PREFIX.length);
    return ConceptId.safeParse(id).success ? `/concepts/${id}` : '';
  }
  return '';
}

function langOf(className: string | undefined): CodeLang {
  const m = /language-([A-Za-z0-9_+-]+)/.exec(className ?? '');
  return CODE_LANG[(m?.[1] ?? '').toLowerCase()] ?? 'text';
}

export function SafeMarkdown({ markdown, variant }: SafeMarkdownProps): ReactElement {
  return (
    <div className={variant === 'read' ? 'max-w-(--measure-read) text-read' : 'text-sm'}>
      <Markdown
        skipHtml
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        urlTransform={transformUrl}
        components={{
          a({ href, children }) {
            if (href === undefined || href === '') {
              return <span>{children}</span>;
            }
            if (/^https?:/i.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                  <ExternalLink {...iconProps()} />
                </a>
              );
            }
            return <a href={href}>{children}</a>;
          },
          img({ src, alt }) {
            if (typeof src === 'string' && src.startsWith('/') && !src.startsWith('//')) {
              return <img src={src} alt={alt ?? ''} loading="lazy" />;
            }
            return <span>{alt ?? ''}</span>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children }) {
            const text = String(children).replace(/\n$/, '');
            const isBlock = /language-/.test(className ?? '') || text.includes('\n');
            if (!isBlock) {
              return <code className="font-mono text-sm">{children}</code>;
            }
            return <CodeBlock code={text} lang={langOf(className)} />;
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
