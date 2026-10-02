// DCP-01 §6.0 공통 타입 — IF-01에 이미 있는 타입(TrackId·ConceptId·Level·Tier·KnowledgeType·Volatility·Tag·SourceId·
// RubricId·SemVer 등)은 @fathom/contracts에서 import하고(STD 핵심 3, 재정의 0), 저작 고유 enum·파일 스키마 조각만 여기 둔다.
import { SourceId } from '@fathom/contracts/common/ids';
import { z } from 'zod';

export const TrackGroup = z.enum(['foundation', 'app', 'infra', 'security', 'ai', 'design_lead']);
export const FacetId = z.enum(['definition', 'mechanism', 'code', 'tradeoff', 'contrast', 'operation']);
export const ResponseMode = z.enum(['recognition', 'production']);
export const Bloom = z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']);
export const Usage = z.enum(['link_only', 'paraphrase', 'short_quote', 'code_adapted']);
export const ObjKey = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
export const StemFamily = z.string().regex(/^sf_[a-z0-9_]{2,28}$/);

function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) {
    return false;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** 날짜는 따옴표 문자열 "YYYY-MM-DD"(달력상 존재하는 날). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, 'not a calendar date');

/** 마크다운 문자열 길이 한정. */
export const Md = (min: number, max: number) => z.string().min(min).max(max);

/** 객체 키 맵: 키 = ObjKey, 항목 수 min..max. */
export const KeyMap = <T extends z.ZodType>(v: T, min = 1, max = 32) =>
  z.record(ObjKey, v).refine((m) => {
    const n = Object.keys(m).length;
    return n >= min && n <= max;
  }, `entry count must be ${min}..${max}`);

export const SourceRef = z
  .object({
    source_id: SourceId,
    locator: z.string().min(1).max(300),
    section: z.string().min(1).max(200),
    usage: Usage,
    retrieved_at: IsoDate,
    product_version: z.string().max(40).optional(),
    quote: z.string().max(200).optional(),
  })
  .strict()
  .refine((r) => (r.usage === 'short_quote') === (r.quote !== undefined), 'quote ⇔ short_quote');

/** 같은 개념의 로컬 키('k03') 또는 다른 개념의 전체 ID('docker.image-layer.k02'). */
export const KuRef = z.string().regex(/^(?:k\d{2}|[a-z0-9]+\.[a-z0-9]+(?:-[a-z0-9]+)*\.k\d{2})$/);
export const McRef = z.string().regex(/^(?:m\d{2}|[a-z0-9]+\.[a-z0-9]+(?:-[a-z0-9]+)*\.m\d{2})$/);
