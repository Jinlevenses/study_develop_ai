import { resolveInsideLexical } from '@fathom/shared-kernel/config/config';

// STD-TS-42 — 경로 결합은 `resolveInsideLexical`만(`path.join`·문자열 연결 금지). 거부되면 `null`.
export function inside(base: string, relative: string, platform?: NodeJS.Platform): string | null {
  const r = resolveInsideLexical(base, relative, platform);
  return r.ok ? r.value : null;
}
