// 작은 glob 구현(의존성 0). 지원: `**`(0개 이상 디렉터리), `*`(`/` 제외), `?`, `{a,b}`(중첩 포함), 나머지 리터럴. 경로는 posix.

/** `{a,b}` 확장. 중첩 중괄호도 처리한다. */
export function expandBraces(p) {
  const open = p.indexOf('{');
  if (open < 0) {
    return [p];
  }
  let depth = 0;
  let close = -1;
  const commas = [];
  for (let i = open; i < p.length; i++) {
    const c = p[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (c === ',' && depth === 1) {
      commas.push(i);
    }
  }
  if (close < 0) {
    return [p];
  }
  const head = p.slice(0, open);
  const tail = p.slice(close + 1);
  const bounds = [open, ...commas, close];
  const out = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const alt = p.slice(bounds[k] + 1, bounds[k + 1]);
    for (const e of expandBraces(head + alt + tail)) {
      out.push(e);
    }
  }
  return out;
}

const RE_SPECIAL = /[.+^$()|[\]\\{}]/;

function oneToRegexSource(p) {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const atSegStart = i === 0 || p[i - 1] === '/';
        if (atSegStart && p[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        if (atSegStart && i + 2 === p.length) {
          out += '.*';
          i += 2;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i++;
      continue;
    }
    out += RE_SPECIAL.test(c) ? `\\${c}` : c;
    i++;
  }
  return out;
}

const cache = new Map();

export function globToRegExp(p) {
  const hit = cache.get(p);
  if (hit) {
    return hit;
  }
  const alts = expandBraces(p).map(oneToRegexSource);
  const re = new RegExp(`^(?:${alts.join('|')})$`);
  cache.set(p, re);
  return re;
}

export function matchGlob(relPath, pattern) {
  return globToRegExp(pattern).test(relPath);
}

export function matchAny(relPath, patterns) {
  return patterns.some((p) => matchGlob(relPath, p));
}
