import { z } from 'zod';

// IF-01 §2.3 — 모든 객체 스키마는 `.strict()`(알 수 없는 키 거부). 이 헬퍼가 그 단일 진입점이다.
export const S = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
