// R-3STAGE — 개념 본문 3단(이론·코드·핵심) 구조 검사(Brief T-01-03 §4.4 표 · §4.7 Tier C 템플릿).
import {
  countChars,
  countSentences,
  directivesOf,
  fencesOf,
  h3Block,
  h3Titles,
  listItemCount,
  sectionText,
} from '../../parse/markdown.js';
import type { MdSection } from '../../parse/markdown.js';
import { finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import type { ConceptFile, LintContext } from '../../validate/model.js';

export const STAGES = ['이론', '코드', '핵심'] as const;

/** Tier C 핵심 섹션(§4.7 템플릿 3줄, `{title.ko}` 치환). */
export function tierCCore(titleKo: string): string {
  return [
    `- 무엇인가: ${titleKo}는 무엇이고 어떤 문제를 푸는가?`,
    `- 왜 필요한가: ${titleKo}가 없으면 무엇이 어려워지는가?`,
    `- 언제 쓰지 않나: ${titleKo}를 쓰지 않는 편이 나은 상황은?`,
  ].join('\n');
}

function checkTierA(c: ConceptFile, theory: MdSection, code: MdSection, core: MdSection, err: (kp: string, m: string) => void): void {
  const d = c.data;
  if (d.learning === undefined) {
    err('learning', 'Tier A requires a learning block');
  }
  const chars = countChars(theory.lines);
  if (chars < 800 || chars > 1200) {
    err('body.이론', `Tier A theory must be 800..1200 characters (is ${chars})`);
  }
  const t3 = h3Titles(theory.lines);
  for (const need of ['왜 필요한가', '메커니즘']) {
    if (!t3.includes(need)) {
      err('body.이론', `Tier A theory needs a '### ${need}' heading`);
    }
  }
  if (!fencesOf(theory.lines).some((f) => f.lang === 'mermaid')) {
    err('body.이론', 'Tier A theory needs at least one mermaid fence');
  }
  if (!directivesOf(theory.lines).some((x) => x.name === 'embed')) {
    err('body.이론', 'Tier A theory needs at least one ::embed directive');
  }

  if (d.stage2_kind === 'code') {
    if (h3Block(code.lines, 'Worked example') === null) {
      err('body.코드', "stage2_kind code needs a '### Worked example' heading");
    }
    const fences = fencesOf(code.lines);
    if (fences.length === 0) {
      err('body.코드', 'stage2_kind code needs at least one code fence');
    } else if (!fences.some((f) => f.content.includes('①'))) {
      err('body.코드', "stage2_kind code needs the '①' subgoal marker inside a code fence");
    }
  } else {
    const block = h3Block(code.lines, '사례');
    if (block === null || countSentences(block) < 3) {
      err('body.코드', "stage2_kind case needs a '### 사례' section with at least 3 sentences");
    }
  }
  if (d.knowledge_type.primary === 'P' && !h3Titles(code.lines).includes('단계 과제')) {
    err('body.코드', "knowledge_type P needs a '### 단계 과제' heading");
  }

  const never = h3Block(core.lines, '언제 쓰지 않나');
  if (never === null || listItemCount(never) < 2) {
    err('body.핵심', "'### 언제 쓰지 않나' needs at least 2 list items");
  }
  if (d.learning !== undefined && Object.keys(d.learning.contrast_pairs).length > 0 && !h3Titles(core.lines).includes('대조')) {
    err('body.핵심', "contrast_pairs need a '### 대조' heading");
  }
  if (!directivesOf(core.lines).some((x) => x.name === 'ku-list')) {
    err('body.핵심', 'core needs a ::ku-list line');
  }
}

function checkTierB(theory: MdSection, code: MdSection, core: MdSection, err: (kp: string, m: string) => void): void {
  if (countSentences(theory.lines) < 1) {
    err('body.이론', 'Tier B theory needs at least one sentence');
  }
  const chars = countChars(theory.lines);
  if (chars > 400) {
    err('body.이론', `Tier B theory must be at most 400 characters (is ${chars})`);
  }
  const fences = fencesOf(code.lines);
  const first = fences[0];
  const fenceOk = first !== undefined && first.contentLines <= 15;
  const caseBlock = h3Block(code.lines, '사례');
  const caseOk = caseBlock !== null && countSentences(caseBlock) >= 3;
  if (!fenceOk && !caseOk) {
    err('body.코드', "Tier B code needs a first code fence of at most 15 lines or a '### 사례' section with at least 3 sentences");
  }
  if (!directivesOf(core.lines).some((x) => x.name === 'ku-list')) {
    err('body.핵심', 'core needs a ::ku-list line');
  }
}

function checkTierC(c: ConceptFile, theory: MdSection, code: MdSection, core: MdSection, err: (kp: string, m: string) => void): void {
  if (c.data.learning !== undefined) {
    err('learning', 'Tier C must not have a learning block');
  }
  if (sectionText(theory) !== c.data.summary_ko) {
    err('body.이론', 'Tier C theory must equal summary_ko exactly');
  }
  if (sectionText(code) !== '::needs-enrichment') {
    err('body.코드', 'Tier C code must be exactly ::needs-enrichment');
  }
  if (sectionText(core) !== tierCCore(c.data.title.ko)) {
    err('body.핵심', 'Tier C core must equal the 3-line skeleton template');
  }
}

export function ruleThreeStage(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.model.concepts) {
    const err = (keypath: string, message: string): void => {
      out.push(finding('R-3STAGE', 'error', c.rel, keypath, message));
    };
    const body = c.body;
    if (body.h1.length > 0) {
      err('body', 'H1 headings are not allowed in the body');
    }
    if (body.preamble !== '') {
      err('body', 'text before the first H2 is not allowed');
    }
    for (const line of body.unclosedFences) {
      err(`body.line${line}`, 'unclosed code fence');
    }
    const titles = body.sections.map((s) => s.title);
    const ordered = titles.length === STAGES.length && STAGES.every((t, i) => titles[i] === t);
    if (!ordered) {
      err('body', `H2 sections must be exactly ${STAGES.join(' · ')} in this order (found: ${titles.join(' · ') || 'none'})`);
      continue;
    }
    const [theory, code, core] = body.sections;
    if (theory === undefined || code === undefined || core === undefined) {
      continue;
    }
    if (c.data.tier === 'A') {
      checkTierA(c, theory, code, core, err);
    } else if (c.data.tier === 'B') {
      checkTierB(theory, code, core, err);
    } else {
      checkTierC(c, theory, code, core, err);
    }
  }
  return out;
}
