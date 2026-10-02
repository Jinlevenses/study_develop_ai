import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(import.meta.dirname, '../../..');
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8');

describe('build files', () => {
  it('UT-WEB-458 vite.config.ts는 127.0.0.1:5173 strictPort·tanstackRouter가 react 앞·routesDirectory·proxy 0이다 [ADR-012][AP-12]', () => {
    const text = read('vite.config.ts');
    expect(text).toContain("host: '127.0.0.1'");
    expect(text).toContain('port: 5173');
    expect(text).toContain('strictPort: true');
    expect(text).toContain("routesDirectory: './src/routing'");
    expect(text).toContain("generatedRouteTree: './src/routeTree.gen.ts'");
    expect(text).toContain('autoCodeSplitting: true');
    expect(text.indexOf('tanstackRouter(')).toBeGreaterThan(-1);
    expect(text.indexOf('tanstackRouter(')).toBeLessThan(text.indexOf('react()'));
    expect(text.indexOf('react()')).toBeLessThan(text.indexOf('tailwindcss()'));
    expect(text).not.toMatch(/proxy/i);
    expect(text).toContain('__FATHOM_APP_VERSION__');
    expect(text).toContain("conditions: ['source', ...defaultClientConditions]");
    expect(text).toContain("outDir: 'dist'");
    expect(text).toContain("target: 'es2023'");
  });

  it('UT-WEB-459 index.html은 lang=ko·theme-init이 모듈 스크립트보다 앞·인라인 스크립트 0이고 manifest·아이콘이 규칙을 지킨다 [AQ-16][NFR-SEC-009]', () => {
    const html = read('index.html');
    expect(html).toMatch(/<html lang="ko"/);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain('<script src="/theme-init.js"></script>');
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('type="module"'));
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toHaveLength(2);
    for (const tag of scripts) {
      expect(tag).toContain('src=');
    }
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toContain('theme-color');
    expect(html).toContain('<title>Fathom 깊이</title>');
    expect(html).toContain('<div id="root"></div>');

    const manifest: unknown = JSON.parse(read('public/manifest.webmanifest'));
    expect(manifest).toEqual({
      name: 'Fathom 깊이',
      short_name: 'Fathom',
      lang: 'ko',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      icons: [{ src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    });
    expect(JSON.stringify(manifest)).not.toMatch(/theme_color|background_color/);
    expect(existsSync(join(WEB, 'public/icons/icon.svg'))).toBe(true);
    expect(existsSync(join(WEB, 'public/theme-init.js'))).toBe(true);
    const svg = read('public/icons/icon.svg');
    expect(statSync(join(WEB, 'public/icons/icon.svg')).size).toBeLessThanOrEqual(2048);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).not.toMatch(/<script|style=|fill=|stroke=|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/);
    expect(read('src/styles/app.css').trim().split('\n')).toEqual([
      '@import "tailwindcss";',
      '@import "@fathom/design-tokens/tokens.css";',
      '@import "@fathom/design-tokens/typography.css";',
      '@source "../../../../packages/ui/src";',
    ]);
  });
});
