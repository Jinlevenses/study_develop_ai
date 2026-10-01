// UT-SK-015용 부모 프로세스: job을 하나 띄우고 자식 pid를 stdout으로 알린 뒤 SIGKILL 당할 때까지 산다.
import { createJobRunner } from '../../../../src/jobs/jobs.js';

const entry = process.argv[2];
if (entry === undefined) {
  throw new Error('invariant: parent fixture needs the job entry path');
}
const runner = createJobRunner({
  entry,
  execArgv: ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'],
});
void runner.run(
  'integrity',
  { mode: 'announce' },
  {
    timeoutMs: 120_000,
    onProgress: (p) => {
      process.stdout.write(`${p.step}\n`);
    },
  },
);
setInterval(() => undefined, 1000);
