import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as artifactMod from '../../../src/http/learning/v1/pre-submit/artifact.js';
import * as blockMod from '../../../src/http/learning/v1/pre-submit/block.js';
import * as caseMod from '../../../src/http/learning/v1/pre-submit/case.js';
import * as noteMod from '../../../src/http/learning/v1/pre-submit/note.js';

// 제출 전 스키마(NG-G3, STD 15)에는 정답·해설·모범답안 필드가 0이어야 한다(content pre-submit 가드와 같은 금지 목록).
const FORBIDDEN = [
  /^answer_key$/,
  /^explanation$/,
  /^explanation_md$/,
  /^is_correct$/,
  /^model_answer$/,
  /^model_answer_md$/,
  /^exemplar_note$/,
  /^exemplar_md$/,
  /^solution$/,
  /^correct_/,
];

function propertyNames(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      propertyNames(child, out);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const rec = node as Record<string, unknown>;
  const props = rec.properties;
  if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
    for (const k of Object.keys(props)) {
      out.add(k);
    }
  }
  for (const v of Object.values(rec)) {
    propertyNames(v, out);
  }
}

const isSchema = (v: unknown): v is z.ZodType => typeof v === 'object' && v !== null && '_zod' in v;

describe('learning pre-submit 금지 필드 가드', () => {
  it('UT-CON-189 learning pre-submit/*.ts 모든 export 스키마의 JSON Schema 속성 이름에 정답·해설·모범답안 계열 0 [FR-QST-022][NFR-UX-008]', () => {
    let checked = 0;
    for (const [file, mod] of Object.entries({
      artifact: artifactMod,
      block: blockMod,
      case: caseMod,
      note: noteMod,
    })) {
      for (const [name, value] of Object.entries(mod)) {
        if (!isSchema(value)) {
          continue;
        }
        const names = new Set<string>();
        propertyNames(z.toJSONSchema(value, { io: 'output', unrepresentable: 'any' }), names);
        expect(names.size, `${file}/${name} 속성 없음`).toBeGreaterThan(0);
        for (const n of names) {
          for (const re of FORBIDDEN) {
            expect(re.test(n), `${file}/${name}.${n}`).toBe(false);
          }
        }
        checked++;
      }
    }
    expect(checked).toBe(4); // BlockViewPreSubmit · NotePreSubmit · CaseRunPreSubmit · ArtifactRunPreSubmit
    // 대조군: 제출 후 노트에는 모범 노트가 있다(제출 전 스키마와 분리돼 있음을 확인).
    const post = new Set<string>();
    propertyNames(z.toJSONSchema(z.object({ model_answer_md: z.string() })), post);
    expect(FORBIDDEN.some((re) => [...post].some((n) => re.test(n)))).toBe(true);
  });
});
