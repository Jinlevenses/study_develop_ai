import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as caseMod from '../../../src/http/content/v1/pre-submit/case.js';
import * as conceptMod from '../../../src/http/content/v1/pre-submit/concept.js';
import * as hintMod from '../../../src/http/content/v1/pre-submit/hint.js';
import * as itemMod from '../../../src/http/content/v1/pre-submit/item.js';

// UT-CON-111 — 제출 전 스키마(NG-G3, STD 15)에는 정답·해설·모범답안 필드가 0이어야 한다.
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

describe('content pre-submit 금지 필드 가드', () => {
  it('UT-CON-111 content pre-submit/*.ts 모든 export 스키마의 JSON Schema 속성 이름에 정답·해설·모범답안 계열 0 [FR-QST-022][NFR-UX-008]', () => {
    let checked = 0;
    for (const [file, mod] of Object.entries({ case: caseMod, concept: conceptMod, hint: hintMod, item: itemMod })) {
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
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10); // 4개 파일의 export 스키마 전수

    // --- (이어서)
    const bad = z.object({ nested: z.object({ correct_option: z.string(), explanation_md: z.string() }) });
    const names = new Set<string>();
    propertyNames(z.toJSONSchema(bad), names);
    expect([...names].filter((n) => FORBIDDEN.some((re) => re.test(n))).sort()).toEqual([
      'correct_option',
      'explanation_md',
    ]);
  });
});
