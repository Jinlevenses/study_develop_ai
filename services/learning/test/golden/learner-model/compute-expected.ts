// 골든 기대값 생성기/검증기(spec 아님). 플래그 없음 = 비교만(다르면 exit 1), `--update-golden` = expected-projection.json 갱신.
//   node --disable-warning=ExperimentalWarning --import tsx --conditions=source services/learning/test/golden/learner-model/compute-expected.ts [--update-golden]
import { computeAllSets, type ExpectedFile, FSRS_IMPL_EXPECTED, readExpected, writeExpected } from './golden-core.js';

const update = process.argv.includes('--update-golden');
const computed = await computeAllSets();

if (update) {
  const file: ExpectedFile = { format: 'fathom.golden-projection.v1', fsrs_impl: FSRS_IMPL_EXPECTED, sets: computed };
  writeExpected(file);
  process.stdout.write(`updated ${Object.keys(computed).join(', ')}\n`);
  process.exit(0);
}

const expected = readExpected();
const problems: string[] = [];
for (const [name, got] of Object.entries(computed)) {
  const want = expected.sets[name];
  if (want === undefined) {
    problems.push(`${name}: no expected entry (run with --update-golden after review)`);
  } else if (JSON.stringify(want) !== JSON.stringify(got)) {
    problems.push(`${name}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
  }
}
for (const name of Object.keys(expected.sets)) {
  if (!(name in computed)) {
    problems.push(`${name}: expected entry has no computable ledger`);
  }
}
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `ok ${Object.entries(computed)
    .map(([k, v]) => `${k}:${v.projection_hash.slice(0, 12)}`)
    .join(' ')}\n`,
);
