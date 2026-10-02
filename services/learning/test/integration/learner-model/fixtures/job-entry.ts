// 통합 테스트용 job 진입점(`--mode=job --job=<name>`): replay-verify·rebuild를 SQL 리플레이 소스로 띄운다.
// 운영 결선(T-01-09)은 `createLedgerReplayReader()`(T-01-02)를 같은 팩토리에 넘긴다.
import { processJobChannel, serveJob } from '@fathom/shared-kernel/jobs/jobs';
import { makeRebuildJob } from '../../../../src/jobs/rebuild.js';
import { makeReplayVerifyJob } from '../../../../src/jobs/replay-verify.js';
import { createSqlReplaySource } from '../support/sql-replay-source.js';

const source = createSqlReplaySource();
const code = await serveJob([makeReplayVerifyJob({ source }), makeRebuildJob({ source })], processJobChannel());
process.exit(code);
