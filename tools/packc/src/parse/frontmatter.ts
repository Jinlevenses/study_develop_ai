// `---` YAML frontmatter `---` + 본문 분리(Brief T-01-03 §4.2). 파싱은 parseYamlStrict 단일 경로(load.ts).
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

export type SplitFrontmatter = {
  readonly yaml: string;
  /** frontmatter 닫는 줄 다음부터의 본문(첫 줄 공백 포함 원문 그대로). */
  readonly body: string;
};

/** 첫 줄이 정확히 `---`, 다음 `---` 줄까지가 frontmatter. */
export function splitFrontmatter(text: string): Result<SplitFrontmatter, string> {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    return err('first line must be exactly ---');
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return err('closing --- line not found');
  }
  return ok({ yaml: lines.slice(1, close).join('\n'), body: lines.slice(close + 1).join('\n') });
}
