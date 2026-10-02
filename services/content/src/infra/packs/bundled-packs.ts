import { readdirSync } from 'node:fs';
import path from 'node:path';
import { PackId, SemVer } from '@fathom/contracts/common/ids';
import { compareSemver } from '../../domain/catalog/install/semver.js';

// PGM-CT-001 `bundled` 원천 해석 — Brief T-01-07 §4.4-1. 파일 이름 `<pack_id>@<version>.fpack`.

export type BundledPack = { readonly pack_id: string; readonly version: string; readonly file: string };

const NAME_RE = /^([^@]+)@(.+)\.fpack$/;

/** `packsDir`의 이름이 규칙에 맞는 `.fpack` 전부(디렉터리가 없으면 빈 목록). pack_id·version 순. */
export function listBundledPacks(packsDir: string): readonly BundledPack[] {
  let names: string[];
  try {
    names = readdirSync(packsDir);
  } catch {
    return [];
  }
  const out: BundledPack[] = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    const id = PackId.safeParse(m?.[1]);
    const version = SemVer.safeParse(m?.[2]);
    if (id.success && version.success) {
      out.push({ pack_id: id.data, version: version.data, file: path.join(packsDir, name) });
    }
  }
  return out.sort((a, b) => {
    if (a.pack_id !== b.pack_id) {
      return a.pack_id < b.pack_id ? -1 : 1;
    }
    return compareSemver(a.version, b.version);
  });
}

/** 팩마다 semver 최댓값 1개. `track`이 있으면 그 팩(`pack_id = track`)만. 0개면 빈 배열. */
export function selectBundledPacks(all: readonly BundledPack[], track: string | null): readonly BundledPack[] {
  const best = new Map<string, BundledPack>();
  for (const p of all) {
    if (track !== null && p.pack_id !== track) {
      continue;
    }
    const cur = best.get(p.pack_id);
    if (cur === undefined || compareSemver(p.version, cur.version) > 0) {
      best.set(p.pack_id, p);
    }
  }
  return [...best.values()].sort((a, b) => (a.pack_id === b.pack_id ? 0 : a.pack_id < b.pack_id ? -1 : 1));
}
