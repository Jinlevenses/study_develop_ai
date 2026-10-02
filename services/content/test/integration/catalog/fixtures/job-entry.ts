// 통합 테스트 job 진입점(`--mode=job --job=pack-load`): 실제 `makePackLoadJob` + 호출을 파일에 남기는 가짜 문항 핸들러.
// 홈의 `data/crash-on-ingest` 표지 파일이 있으면 문항 적재 도중 자식을 강제 종료한다(IT-232).
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { processJobChannel, serveJob } from '@fathom/shared-kernel/jobs/jobs';
import type { PackIngestHandler } from '../../../../src/application/catalog/ports.js';
import { makePackLoadJob } from '../../../../src/jobs/pack-load.js';

const handler: PackIngestHandler = {
  kinds: ['item', 'item_model', 'gate_result'],
  ingest(db, ctx, records): void {
    const dir = path.dirname(db.path);
    if (existsSync(path.join(dir, 'crash-on-ingest'))) {
      process.exit(9);
    }
    appendFileSync(path.join(dir, 'ingest-calls.log'), `ingest ${ctx.install_id} ${records.length}\n`);
  },
  purge(db, installId): void {
    appendFileSync(path.join(path.dirname(db.path), 'ingest-calls.log'), `purge ${installId}\n`);
  },
  activate(): void {},
};

const code = await serveJob([makePackLoadJob({ ingest: { handlers: [handler] } })], processJobChannel());
process.exit(code);
