import path from 'node:path';
import { insertInstallRows } from '../../../../src/application/catalog/ingest/install-rows.js';
import type { PackLoadContext } from '../../../../src/application/catalog/ingest/pack-load-run.js';
import type { VerifiedFpack } from '../../../../src/infra/packs/fpack-reader.js';
import { readFpack } from '../../../../src/infra/packs/fpack-reader.js';
import type { Fixture } from './db.js';
import type { PackSpec, Tamper } from './fpack-writer.js';
import { itemRecord, writeFpack } from './fpack-writer.js';

export type Staged = {
  readonly installId: string;
  readonly requestId: string;
  readonly file: string;
  readonly fpack: VerifiedFpack;
};

/** `.fpack`을 쓰고 검증해 `ct_pack(state = loading)` 행까지 만든다(부모 install 동기 부분의 축약). */
export function stageInstall(
  fx: Fixture,
  spec: PackSpec,
  tamper: Tamper = {},
  previousVersion: string | null = null,
): Staged {
  const { file } = writeFpack(path.join(fx.home.home, 'packs'), spec, tamper);
  const read = readFpack(file);
  if (!read.ok) {
    throw new Error(`stageInstall: ${read.error.reason}`);
  }
  const installId = fx.newId();
  const requestId = fx.newId();
  insertInstallRows(
    fx.db,
    [
      {
        install_id: installId,
        request_id: requestId,
        previous_version: previousVersion,
        channel: 'seed',
        fpack: read.value,
      },
    ],
    fx.clock.now(),
  );
  return { installId, requestId, file, fpack: read.value };
}

export type ProgressLog = { readonly calls: { pct: number | null; step: string }[]; readonly ctx: PackLoadContext };

export function loadContext(signal: AbortSignal = new AbortController().signal): ProgressLog {
  const calls: { pct: number | null; step: string }[] = [];
  return {
    calls,
    ctx: {
      progress(pct: number | null, step: string): void {
        calls.push({ pct, step });
      },
      signal,
    },
  };
}

/** `n`개 문항 레코드를 첫 개념(c001)에 덧붙여 번들 레코드 수를 정확히 맞춘다. */
export function withExtraItems(spec: PackSpec, n: number): PackSpec {
  const extra = Array.from({ length: n }, (_, i) => itemRecord(spec.track ?? 'k8s', 'c001', i + 1));
  return { ...spec, extra_records: [...(spec.extra_records ?? []), ...extra] };
}
