// 팩 → .fpack 컴파일(Brief T-01-03 §4.8). 순수 계산(바이트까지) + 원자적 쓰기 분리. 같은 원천 → 같은 바이트.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { Finding } from '../validate/finding.js';
import type { LintContext } from '../validate/model.js';
import type { V7Binding } from '../validate/v7-binding.js';
import { bindV7 } from '../validate/v7-binding.js';
import { dayToEpochMs, detUlid } from './det-ulid.js';
import { buildManifest, PACKC_VERSION, serializeManifest } from './manifest.js';
import { merkleRoot } from './merkle.js';
import type { PackBodies, PackRecords } from './records.js';
import { buildBodies, finalizePack } from './records.js';
import { buildReport } from './report.js';
import { buildTar } from './tar.js';

export const LAYOUT_JSON = `${canonicalJson({ nodes: {}, schema_v: 1, status: 'deferred' })}\n`;

export type PackBuild = {
  readonly packId: string;
  readonly version: string;
  readonly fileName: string;
  /** G0 error가 있으면 null. */
  readonly fpack: Buffer | null;
  readonly merkleRoot: string | null;
  readonly findings: readonly Finding[];
  readonly bodies: PackBodies;
  readonly binding: V7Binding;
  readonly records: PackRecords;
};

export type BuildOptions = {
  readonly ctx: LintContext;
  readonly packId: string;
  /** 이 팩의 V2 warn 수(report.validators.V2.warnings). */
  readonly v2Warnings: number;
};

/** 레코드·V7 바인딩까지만(쓰기·직렬화 없음) — `check`의 V7 단계와 `hashes`가 쓴다. */
export function prepare(
  ctx: LintContext,
  packId: string,
): { bodies: PackBodies; binding: V7Binding; records: PackRecords } {
  const bodies = buildBodies({ ctx, packId });
  const binding = bindV7(
    bodies.items,
    ctx.model.v7.filter((v) => v.data.pack_id === packId),
  );
  const records = finalizePack(bodies, binding.gate, detUlid);
  return { bodies, binding, records };
}

export function buildPack(opts: BuildOptions): PackBuild {
  const { ctx, packId } = opts;
  const { bodies, binding, records } = prepare(ctx, packId);
  const version = bodies.version;
  const fileName = `${packId}@${version}.fpack`;
  const findings = [...records.findings, ...binding.findings];
  if (records.findings.some((f) => f.severity === 'error')) {
    return { packId, version, fileName, fpack: null, merkleRoot: null, findings, bodies, binding, records };
  }
  const lines = records.records.map((r) => canonicalJson(r));
  const bundle = lines.map((l) => `${l}\n`).join('');
  const root = merkleRoot(lines);

  const itemFormats = new Map<string, number>();
  for (const it of bodies.items) {
    itemFormats.set(it.format, (itemFormats.get(it.format) ?? 0) + 1);
  }
  const countKind = (kind: string): number => records.records.filter((r) => r.kind === kind).length;
  const report = buildReport({
    packId,
    version,
    packcVersion: PACKC_VERSION,
    concepts: bodies.concepts,
    kus: countKind('ku'),
    misconceptions: countKind('misconception'),
    itemModels: countKind('item_model'),
    items: bodies.items,
    itemFormats,
    cap: bodies.cap,
    offlineLearnable: bodies.offlineLearnable,
    gate: { ...binding.counts, stale: binding.stale },
    v2Warnings: opts.v2Warnings,
  });
  const reportText = `${canonicalJson(report)}\n`;

  const requiredForLevel = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let latestDay = '';
  for (const c of bodies.concepts) {
    if (c.data.required_for_level !== null) {
      requiredForLevel[String(c.data.required_for_level) as keyof typeof requiredForLevel] += 1;
    }
    if (c.data.review.valid_as_of > latestDay) {
      latestDay = c.data.review.valid_as_of;
    }
  }
  const manifest = buildManifest({
    packId,
    version,
    bundle,
    report: reportText,
    layout: LAYOUT_JSON,
    merkleRoot: root,
    counts: {
      concepts: countKind('concept'),
      kus: countKind('ku'),
      misconceptions: countKind('misconception'),
      items: countKind('item'),
      cases: 0,
    },
    requiredForLevel,
    offlineCapLevel: bodies.cap.offline_cap_level,
    createdAt: latestDay === '' ? 0 : dayToEpochMs(latestDay),
  });
  const fpack = buildTar([
    { name: 'manifest.json', data: Buffer.from(serializeManifest(manifest), 'utf8') },
    { name: 'bundle.jsonl', data: Buffer.from(bundle, 'utf8') },
    { name: 'report.json', data: Buffer.from(reportText, 'utf8') },
    { name: 'layout.json', data: Buffer.from(LAYOUT_JSON, 'utf8') },
  ]);
  return { packId, version, fileName, fpack, merkleRoot: root, findings, bodies, binding, records };
}

/** `<out>/<pack_id>@<version>.fpack`를 `*.tmp` → rename으로 쓴다. */
export function writeFpack(outDir: string, build: PackBuild): string {
  if (build.fpack === null) {
    throw new Error('invariant: cannot write a pack with G0 errors');
  }
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, build.fileName);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, build.fpack);
  renameSync(tmp, target);
  return target;
}
