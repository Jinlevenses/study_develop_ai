import { stat } from 'node:fs/promises';
import { resolveInside } from '@fathom/shared-kernel/config/config';

// 정적 요청 경로 → 루트 안의 상대 경로(STD-SEC-03). 디코드 실패·NUL·경로 조작·점 파일은 전부 `forbidden`(= 404로 응답).

export type StaticTarget =
  | { readonly kind: 'file'; readonly rel: string }
  | { readonly kind: 'missing'; readonly rel: string }
  | { readonly kind: 'forbidden' };

export function relFromUrlPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // 잘못된 % 시퀀스
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  return rel === '' ? 'index.html' : rel;
}

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch {
    return false;
  }
}

export async function resolveStaticTarget(root: string, urlPath: string): Promise<StaticTarget> {
  const rel = relFromUrlPath(urlPath);
  if (rel === null || rel.split(/[\\/]/).some((segment) => segment.startsWith('.') && segment !== '')) {
    return { kind: 'forbidden' };
  }
  const inside = await resolveInside(root, rel);
  if (!inside.ok) {
    return { kind: 'forbidden' };
  }
  return (await isFile(inside.value)) ? { kind: 'file', rel } : { kind: 'missing', rel };
}

/** 마지막 경로 조각에 `.`이 없으면 SPA 라우트로 본다. */
export function isSpaRoute(rel: string): boolean {
  const last = rel.split('/').pop() ?? '';
  return !last.includes('.');
}
