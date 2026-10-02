import type { z } from 'zod';

/**
 * 라우트 `validateSearch`용 — 검증 실패(미지 키 포함)는 `schema.parse({})`(전부 optional이므로 `{}`)로 대체한다.
 * 기본값은 넣지 않는다(feature 몫).
 */
export function safeSearch<S extends z.ZodType>(schema: S): (raw: Record<string, unknown>) => z.output<S> {
  return (raw: Record<string, unknown>): z.output<S> => {
    const r = schema.safeParse(raw);
    return r.success ? r.data : schema.parse({});
  };
}
