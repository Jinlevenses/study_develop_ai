// manifest.json 생성(Brief T-01-03 §4.8-6) · packc 버전 상수(`PACKC_VERSION` = '0.1.0', [Brief 결정]).
import { FpackManifest } from '@fathom/contracts/pack/manifest';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { z } from 'zod';

export const PACKC_VERSION = '0.1.0';

type ManifestT = z.infer<typeof FpackManifest>;

export type ManifestInput = {
  readonly packId: string;
  readonly version: string;
  readonly bundle: string;
  readonly report: string;
  readonly layout: string;
  readonly merkleRoot: string;
  readonly counts: ManifestT['counts'];
  readonly requiredForLevel: ManifestT['required_for_level'];
  readonly offlineCapLevel: number;
  readonly createdAt: number;
};

function fileEntry(path: 'bundle.jsonl' | 'report.json' | 'layout.json', text: string): ManifestT['files'][number] {
  const bytes = Buffer.from(text, 'utf8');
  return { path, sha256: sha256Hex(bytes), bytes: bytes.length };
}

/** `FpackManifest.parse` 통과 객체를 만든다(실패 = 예외 → exit 2). */
export function buildManifest(input: ManifestInput): ManifestT {
  return FpackManifest.parse({
    pack_id: input.packId,
    track: input.packId,
    version: input.version,
    channel: 'seed',
    schema_v: 1,
    packc_version: PACKC_VERSION,
    files: [
      fileEntry('bundle.jsonl', input.bundle),
      fileEntry('report.json', input.report),
      fileEntry('layout.json', input.layout),
    ],
    merkle_root: input.merkleRoot,
    counts: input.counts,
    required_for_level: input.requiredForLevel,
    offline_cap_level: input.offlineCapLevel,
    created_at: input.createdAt,
  });
}

/** 직렬화 = canonicalJson + `\n`. */
export function serializeManifest(manifest: ManifestT): string {
  return `${canonicalJson(manifest)}\n`;
}
