// verification-class: V-build·V-ci·V-live·V-field 등급 집계와 RTM V 열 대조(PGM-SID-004, DR-028). 순수 함수.
import type { ReqRow } from './rtm-source.js';

export interface ClassEntry {
  build: boolean;
  beyond: string[];
}

export interface VerificationClass {
  default: string;
  exceptions: Map<string, ClassEntry>;
}

export interface VMismatch {
  id: string;
  rtm: string;
  manifest: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** verification-class.json(`{default, exceptions: {id: {build, beyond[]}}}`) 파싱. 모양이 다르면 null. */
export function parseVerificationClass(data: unknown): VerificationClass | null {
  if (!isObj(data) || typeof data.default !== 'string' || !isObj(data.exceptions)) {
    return null;
  }
  const exceptions = new Map<string, ClassEntry>();
  for (const [id, raw] of Object.entries(data.exceptions)) {
    if (!isObj(raw)) {
      return null;
    }
    const beyond = Array.isArray(raw.beyond) ? raw.beyond.filter((b): b is string => typeof b === 'string') : [];
    exceptions.set(id, { build: raw.build !== false, beyond });
  }
  return { default: data.default, exceptions };
}

/** RTM-01 §7 코드 블록에서 JSON 원천을 꺼낸다(파일이 없을 때의 대체). */
export function extractClassFromRtm(md: string): VerificationClass | null {
  const m = /##\s+7\.[^\n]*verification-class\.json[^\n]*\n[\s\S]*?```json\n([\s\S]*?)```/.exec(md);
  if (m?.[1] === undefined) {
    return null;
  }
  try {
    return parseVerificationClass(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/** 등급의 RTM 표기: 기본 = `V-build`, 예외 = `B+V-ci/V-live`. */
export function classLabel(vc: VerificationClass, id: string): string {
  const e = vc.exceptions.get(id);
  if (e === undefined) {
    return vc.default;
  }
  return `${e.build ? 'B+' : ''}${e.beyond.join('/')}`;
}

/** RTM V 열과 등급 파일이 다른 요구. */
export function vMismatches(rows: ReqRow[], vc: VerificationClass): VMismatch[] {
  const out: VMismatch[] = [];
  for (const r of rows) {
    const manifest = classLabel(vc, r.id);
    if (r.v.trim() !== manifest) {
      out.push({ id: r.id, rtm: r.v.trim(), manifest });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ClassSummary {
  /** 표기별 요구 수(`V-build`·`B+V-ci` …). */
  byLabel: Record<string, number>;
  /** V-build 밖 검증이 있는 요구 수(예외). */
  exceptions: number;
  /** 밖 검증 종류별 요구 수(V-ci·V-live·V-field). */
  beyond: Record<string, number>;
}

/** 요구 목록의 등급 집계. */
export function summarizeClasses(rows: ReqRow[], vc: VerificationClass): ClassSummary {
  const byLabel: Record<string, number> = {};
  const beyond: Record<string, number> = { 'V-ci': 0, 'V-live': 0, 'V-field': 0 };
  let exceptions = 0;
  for (const r of rows) {
    const label = classLabel(vc, r.id);
    byLabel[label] = (byLabel[label] ?? 0) + 1;
    const e = vc.exceptions.get(r.id);
    if (e !== undefined) {
      exceptions++;
      for (const b of e.beyond) {
        beyond[b] = (beyond[b] ?? 0) + 1;
      }
    }
  }
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(byLabel).sort()) {
    sorted[k] = byLabel[k] ?? 0;
  }
  return { byLabel: sorted, exceptions, beyond };
}
