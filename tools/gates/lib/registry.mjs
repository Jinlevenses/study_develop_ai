// 게이트 레지스트리(ADR-010 §4, 동결 순서). stage: g1·g2·g3·audit. fixture = tools/gates/fixtures/<fixture>/.
export const GATES = [
  {
    id: 'check:boundaries',
    script: 'check-boundaries.mjs',
    stage: 'g1',
    args: ['--engine=both'],
    fixture: 'check-boundaries',
  },
  { id: 'check:deps', script: 'check-deps.mjs', stage: 'g1', args: [], fixture: 'check-deps' },
  {
    id: 'check:tsconfig-paths',
    script: 'check-tsconfig-paths.mjs',
    stage: 'g1',
    args: [],
    fixture: 'check-tsconfig-paths',
  },
  { id: 'check:security', script: 'check-security-scan.mjs', stage: 'g1', args: [], fixture: 'check-security-scan' },
  { id: 'check:scope', script: 'check-scope.mjs', stage: 'g1', args: [], fixture: 'check-scope' },
  { id: 'check:sql', script: 'check-sql-template.mjs', stage: 'g2', args: [], fixture: 'check-sql-template' },
  { id: 'check:sql-typed', script: 'check-sql-typed.mjs', stage: 'g2', args: [], fixture: 'check-sql-typed' },
  { id: 'check:db-paths', script: 'check-db-paths.mjs', stage: 'g2', args: [], fixture: 'check-db-paths' },
  {
    id: 'check:ledger-writer',
    script: 'check-ledger-writer.mjs',
    stage: 'g2',
    args: [],
    fixture: 'check-ledger-writer',
  },
  {
    id: 'check:content-ingest',
    script: 'check-content-ingest.mjs',
    stage: 'g2',
    args: [],
    fixture: 'check-content-ingest',
  },
  { id: 'check:jev-index', script: 'check-jev-index.mjs', stage: 'g2', args: [], fixture: 'check-jev-index' },
  { id: 'check:ng-g', script: 'check-ng-g.mjs', stage: 'g2', args: [], fixture: 'check-ng-g' },
  { id: 'check:typo-ko', script: 'check-typo-ko.mjs', stage: 'g2', args: [], fixture: 'check-typo-ko' },
  { id: 'lint:hooks', script: 'check-hooks.mjs', stage: 'g2', args: [], fixture: 'check-hooks' },
  { id: 'check:frozen', script: 'check-frozen.mjs', stage: 'g2', args: [], fixture: 'check-frozen' },
  { id: 'check:consumers', script: 'check-consumers.mjs', stage: 'g2', args: [], fixture: 'check-consumers' },
  { id: 'check:manifest', script: 'check-manifest.mjs', stage: 'g3', args: [], fixture: 'check-manifest' },
  { id: 'check:rtm', script: 'check-rtm.mjs', stage: 'g3', args: [], fixture: 'check-rtm' },
  {
    id: 'audit:graph',
    script: 'check-graphify-edges.mjs',
    stage: 'audit',
    args: [],
    fixture: 'check-graphify-edges',
  },
];

const CUMULATIVE = { g1: ['g1'], g2: ['g1', 'g2'], g3: ['g1', 'g2', 'g3'], audit: ['audit'] };

/** 단계별 게이트(g1 ⊂ g2 ⊂ g3 누적, 레지스트리 순서 유지). */
export function gatesForStage(stage, gates = GATES) {
  const stages = CUMULATIVE[stage];
  if (!stages) {
    throw new RangeError(`unknown stage: ${stage}`);
  }
  return gates.filter((g) => stages.includes(g.stage));
}
