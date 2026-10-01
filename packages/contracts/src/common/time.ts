import { z } from 'zod';

export const EpochMs = z.number().int().min(0).max(8_640_000_000_000_000);
export type EpochMs = z.infer<typeof EpochMs>;
export const StudyDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/); // 사용자 일 경계(기본 04:00) 기준 로컬 날짜
export type StudyDay = z.infer<typeof StudyDay>;
export const IsoWeek = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/); // '2026-W40'
export type IsoWeek = z.infer<typeof IsoWeek>;
export const DurationMs = z.number().int().min(0);
export type DurationMs = z.infer<typeof DurationMs>;
