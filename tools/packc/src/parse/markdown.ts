// 개념 본문 파서(Brief T-01-03 §4.2 "본문"): 펜스를 먼저 인식해 펜스 안의 `#`·`::`는 헤딩·지시문이 아니다.
// H2 = ^## (.+)$ · H3 = ^### (.+)$ · 지시문 = 펜스 밖 줄 전체가 ::embed[x] ::lab[x] ::case[x] ::ku-list ::needs-enrichment.

export type MdLine = {
  readonly text: string;
  /** 'open' = 펜스 여는 줄, 'in' = 펜스 안, 'close' = 닫는 줄, null = 펜스 밖. */
  readonly fence: 'open' | 'in' | 'close' | null;
  /** 1부터 센 본문 줄 번호. */
  readonly line: number;
};

export type Fence = {
  /** 여는 줄의 ``` 뒤 정보 문자열(trim). */
  readonly info: string;
  readonly lang: string;
  /** `mermaid <dg_key>`의 두 번째 토큰, 아니면 null. */
  readonly key: string | null;
  /** 여는·닫는 줄을 뺀 내용(줄바꿈 LF). */
  readonly content: string;
  readonly contentLines: number;
};

export type DirectiveName = 'embed' | 'lab' | 'case' | 'ku-list' | 'needs-enrichment';
export type Directive = { readonly name: DirectiveName; readonly arg: string | null; readonly line: number };

export type MdSection = {
  readonly title: string;
  /** H2 줄 번호. */
  readonly line: number;
  readonly lines: readonly MdLine[];
};

export type ParsedBody = {
  /** 펜스 밖 `# ` 헤딩 줄 텍스트. */
  readonly h1: readonly string[];
  readonly sections: readonly MdSection[];
  /** 첫 H2 앞의 본문(공백 줄 제외하고 내용이 있으면 비어 있지 않다). */
  readonly preamble: string;
  /** `::`로 시작하지만 지시문 문법이 아닌 펜스 밖 줄. */
  readonly malformedDirectives: readonly { readonly line: number; readonly text: string }[];
  /** 닫히지 않은 펜스의 여는 줄 번호들. */
  readonly unclosedFences: readonly number[];
};

const DIRECTIVE_ARG_RE = /^::(embed|lab|case)\[([^\]]+)\]$/;
const DIRECTIVE_BARE_RE = /^::(ku-list|needs-enrichment)$/;
const FENCE_OPEN_RE = /^```(.*)$/;
const FENCE_CLOSE_RE = /^```\s*$/;

export function parseBody(body: string): ParsedBody {
  const raw = body.split('\n');
  const all: MdLine[] = [];
  const unclosedFences: number[] = [];
  let inFence = false;
  let openedAt = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const text = raw[i] ?? '';
    const line = i + 1;
    if (inFence) {
      if (FENCE_CLOSE_RE.test(text)) {
        all.push({ text, fence: 'close', line });
        inFence = false;
      } else {
        all.push({ text, fence: 'in', line });
      }
    } else if (FENCE_OPEN_RE.test(text)) {
      all.push({ text, fence: 'open', line });
      inFence = true;
      openedAt = line;
    } else {
      all.push({ text, fence: null, line });
    }
  }
  if (inFence) {
    unclosedFences.push(openedAt);
  }

  const h1: string[] = [];
  const malformedDirectives: { line: number; text: string }[] = [];
  const sections: { title: string; line: number; lines: MdLine[] }[] = [];
  const preambleLines: string[] = [];
  let current: { title: string; line: number; lines: MdLine[] } | null = null;
  for (const l of all) {
    if (l.fence === null) {
      const h2 = /^## (.+)$/.exec(l.text);
      if (h2 !== null) {
        current = { title: (h2[1] ?? '').trim(), line: l.line, lines: [] };
        sections.push(current);
        continue;
      }
      const h1m = /^# (.+)$/.exec(l.text);
      if (h1m !== null) {
        h1.push((h1m[1] ?? '').trim());
      }
      if (l.text.startsWith('::') && !DIRECTIVE_ARG_RE.test(l.text) && !DIRECTIVE_BARE_RE.test(l.text)) {
        malformedDirectives.push({ line: l.line, text: l.text });
      }
    }
    if (current === null) {
      preambleLines.push(l.text);
    } else {
      current.lines.push(l);
    }
  }
  return {
    h1,
    sections,
    preamble: preambleLines.join('\n').trim(),
    malformedDirectives,
    unclosedFences,
  };
}

/** 섹션 텍스트: H2 다음 줄 ~ 다음 H2 직전, 앞뒤 공백 줄 제거. */
export function linesText(lines: readonly MdLine[]): string {
  return lines
    .map((l) => l.text)
    .join('\n')
    .trim();
}

export function sectionText(section: MdSection): string {
  return linesText(section.lines);
}

/** 펜스 밖 H3 제목들(등장 순서). */
export function h3Titles(lines: readonly MdLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.fence === null) {
      const m = /^### (.+)$/.exec(l.text);
      if (m !== null) {
        out.push((m[1] ?? '').trim());
      }
    }
  }
  return out;
}

/** `### <title>` 아래(다음 H3 직전까지) 줄. 없으면 null. */
export function h3Block(lines: readonly MdLine[], title: string): MdLine[] | null {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l !== undefined && l.fence === null) {
      const m = /^### (.+)$/.exec(l.text);
      if (m !== null && (m[1] ?? '').trim() === title) {
        start = i + 1;
        break;
      }
    }
  }
  if (start === -1) {
    return null;
  }
  const out: MdLine[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const l = lines[i];
    if (l === undefined) {
      continue;
    }
    if (l.fence === null && /^### /.test(l.text)) {
      break;
    }
    out.push(l);
  }
  return out;
}

export function fencesOf(lines: readonly MdLine[]): Fence[] {
  const out: Fence[] = [];
  let info = '';
  let buf: string[] = [];
  for (const l of lines) {
    if (l.fence === 'open') {
      info = (FENCE_OPEN_RE.exec(l.text)?.[1] ?? '').trim();
      buf = [];
    } else if (l.fence === 'in') {
      buf.push(l.text);
    } else if (l.fence === 'close') {
      const tokens = info.split(/\s+/).filter((t) => t !== '');
      const lang = tokens[0] ?? '';
      out.push({
        info,
        lang,
        key: lang === 'mermaid' ? (tokens[1] ?? null) : null,
        content: buf.join('\n'),
        contentLines: buf.length,
      });
    }
  }
  return out;
}

export function directivesOf(lines: readonly MdLine[]): Directive[] {
  const out: Directive[] = [];
  for (const l of lines) {
    if (l.fence !== null) {
      continue;
    }
    const a = DIRECTIVE_ARG_RE.exec(l.text);
    if (a !== null) {
      const name = a[1];
      if (name === 'embed' || name === 'lab' || name === 'case') {
        out.push({ name, arg: a[2] ?? null, line: l.line });
      }
      continue;
    }
    const b = DIRECTIVE_BARE_RE.exec(l.text);
    if (b !== null) {
      const name = b[1];
      if (name === 'ku-list' || name === 'needs-enrichment') {
        out.push({ name, arg: null, line: l.line });
      }
    }
  }
  return out;
}

/** 펜스 밖 `concept:<id>` 링크 대상. */
export function conceptLinksOf(lines: readonly MdLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.fence !== null) {
      continue;
    }
    for (const m of l.text.matchAll(/\[[^\]]*\]\(concept:([^)\s]+)\)/g)) {
      out.push(m[1] ?? '');
    }
  }
  return out;
}

/** 목록 항목(`- `·`* `·`1. `로 시작하는 펜스 밖 줄) 수. */
export function listItemCount(lines: readonly MdLine[]): number {
  let n = 0;
  for (const l of lines) {
    if (l.fence === null && /^\s*(?:[-*]|\d+\.)\s+\S/.test(l.text)) {
      n += 1;
    }
  }
  return n;
}

/**
 * 문자 수 규칙의 정리 단계(Brief §4.2): ① 펜스 블록 ② 지시문 줄 ③ 헤딩 줄 ④ 표 행 제거 → ⑤ 링크 → 텍스트
 * ⑥ ` * _ > 제거 ⑦ 줄머리 목록 표지 제거 ⑧ 연속 공백 → 1칸, trim.
 */
export function cleanText(lines: readonly MdLine[]): string {
  const kept: string[] = [];
  for (const l of lines) {
    if (l.fence !== null) {
      continue;
    }
    if (DIRECTIVE_ARG_RE.test(l.text) || DIRECTIVE_BARE_RE.test(l.text)) {
      continue;
    }
    if (l.text.startsWith('#')) {
      continue;
    }
    if (l.text.startsWith('|')) {
      continue;
    }
    kept.push(l.text);
  }
  let s = kept.join('\n');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/[`*_>]/g, '');
  s = s.replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 문자 수 = 정리 후 NFC 코드포인트 수. */
export function countChars(lines: readonly MdLine[]): number {
  return [...cleanText(lines).normalize('NFC')].length;
}

/** 문장 수 = 정리 후 텍스트에서 `/[.!?。](?=\s|$)/g` 일치 수. */
export function countSentences(lines: readonly MdLine[]): number {
  return (cleanText(lines).match(/[.!?。](?=\s|$)/g) ?? []).length;
}
