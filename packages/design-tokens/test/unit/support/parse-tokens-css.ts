import { readFileSync } from 'node:fs';

export type Decls = Record<string, string>;
export type PaletteOpts = { readonly mode: 'dark' | 'light'; readonly more?: boolean };

const SRC = new URL('../../../src/', import.meta.url);

export function readSrc(name: string): string {
  return readFileSync(new URL(name, SRC), 'utf8');
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 선택자 문자열로 시작하는 블록의 본문(중괄호 짝 맞춤)을 모두 돌려준다. */
export function blockBodies(css: string, selector: string): string[] {
  const src = stripComments(css);
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const idx = src.indexOf(`${selector} {`, from);
    if (idx === -1) {
      break;
    }
    const before = src.slice(0, idx);
    const lineStart = before.lastIndexOf('\n') + 1;
    const startsLine = before.slice(lineStart).trim() === '' || (selector.includes('\n') && lineStart === idx);
    const open = src.indexOf('{', idx);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (startsLine) {
      out.push(src.slice(open + 1, end));
    }
    from = end + 1;
  }
  return out;
}

export function declsOf(body: string): Decls {
  const decls: Decls = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2];
    if (name !== undefined && value !== undefined) {
      decls[name] = value.trim();
    }
  }
  return decls;
}

export function firstBlock(css: string, selector: string, mustContain?: string): Decls {
  const bodies = blockBodies(css, selector).filter((b) => mustContain === undefined || b.includes(mustContain));
  const body = bodies[0];
  if (body === undefined) {
    throw new Error(`블록 없음: ${selector}`);
  }
  return declsOf(body);
}

export const SEL = {
  dark: ':root,\n[data-theme="dark"]',
  light: '[data-theme="light"]',
  more: '[data-contrast="more"]',
  lightMore: '[data-theme="light"][data-contrast="more"]',
} as const;

export function resolveVar(value: string, palette: Decls, depth = 0): string {
  if (depth > 8) {
    throw new Error(`var 순환: ${value}`);
  }
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (m === null) {
    return value.trim();
  }
  const ref = m[1];
  const next = ref === undefined ? undefined : palette[ref];
  if (next === undefined) {
    throw new Error(`끊긴 var: ${value}`);
  }
  return resolveVar(next, palette, depth + 1);
}

/** 다크 ⊕ (light) ⊕ (more) ⊕ (light+more) ⊕ 파생, 원시 선언(var 미해석). */
export function rawPalette(css: string, opts: PaletteOpts): Decls {
  const merged: Decls = { ...firstBlock(css, SEL.dark) };
  if (opts.mode === 'light') {
    Object.assign(merged, firstBlock(css, SEL.light));
  }
  if (opts.more === true) {
    Object.assign(merged, firstBlock(css, SEL.more));
    if (opts.mode === 'light') {
      Object.assign(merged, firstBlock(css, SEL.lightMore));
    }
  }
  Object.assign(merged, firstBlock(css, ':root', '--state-hover'));
  return merged;
}

/** `rawPalette` + var() 재귀 해석. */
export function palette(css: string, opts: PaletteOpts): Decls {
  const raw = rawPalette(css, opts);
  const out: Decls = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = resolveVar(v, raw);
  }
  return out;
}
