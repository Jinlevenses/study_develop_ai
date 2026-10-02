// UT-LR-503 자식 프로세스 진입점: 고정 이벤트열을 리플레이해 슬라이스 해시를 stdout 한 줄로 낸다(TZ는 부모가 env로 지정).
import { generateLedger } from '../../../unit/learner-model/support/generator.js';
import { MemoryResolver, runReplay, sliceHash } from '../../../unit/learner-model/support/memory.js';
import { makeParams, REPO_PARAMS } from '../../../unit/learner-model/support/policy.js';

const alt = makeParams({ fsrs: (f) => ({ ...f, request_retention: { ...f.request_retention, B: 0.8 } }) });
const events = generateLedger(503, {
  min: 100,
  max: 120,
  policySets: [REPO_PARAMS.policy_version, alt.policy_version],
});
const slice = runReplay(events, new MemoryResolver([REPO_PARAMS, alt]));
process.stdout.write(`${sliceHash(slice)} ${events.length} ${process.env.TZ ?? ''}\n`);
