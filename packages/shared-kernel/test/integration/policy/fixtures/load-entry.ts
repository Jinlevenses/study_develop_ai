// 통합 테스트용 진입점: 정책을 로드하고 실패하면 `exitCode`로 종료한다(STD-ERR-20 — process.exit는 진입점만).
import { z } from 'zod';
import { loadPolicy } from '../../../../src/policy/policy.js';

const [policyDir, name, versionText] = process.argv.slice(2);
if (policyDir === undefined || name === undefined || versionText === undefined) {
  throw new Error('invariant: load-entry needs <policyDir> <name> <version>');
}
const schema = z.object({ version: z.string() }).passthrough();
const result = loadPolicy(name, Number(versionText), { policyDir, schema });
if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result.error)}\n`);
  process.exit(result.error.exitCode);
}
process.stdout.write(`${result.value.ref} ${result.value.sha256}\n`);
