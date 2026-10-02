import { getChoseong } from 'es-hangul';

const CHOSEONG_FIRST = 0x3131;
const CHOSEONG_LAST = 0x314e;

function stripSpaces(s: string): string {
  return s.replace(/\s+/gu, '');
}

function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/** 공백을 뺀 모든 글자가 한글 자음(U+3131~U+314E)이면 초성 질의다. */
export function isChoseongQuery(q: string): boolean {
  const body = stripSpaces(q);
  if (body === '') {
    return false;
  }
  for (const ch of body) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < CHOSEONG_FIRST || cp > CHOSEONG_LAST) {
      return false;
    }
  }
  return true;
}

export function matchesQuery(text: string, query: string, keywords: readonly string[] = []): boolean {
  const q = normalize(query.trim());
  if (q === '') {
    return true;
  }
  const targets = [text, ...keywords].map(normalize);
  if (isChoseongQuery(q)) {
    const needle = stripSpaces(q);
    return targets.some((t) => getChoseong(stripSpaces(t)).includes(needle));
  }
  return targets.some((t) => t.includes(q));
}

/** `@fathom/ui` `Command`의 `filter`에 주입 — 매치 1, 아니면 0. */
export function commandFilter(value: string, search: string, keywords?: string[]): number {
  return matchesQuery(value, search, keywords ?? []) ? 1 : 0;
}
