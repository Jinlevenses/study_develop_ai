import { realCliDeps } from './lib/real-deps.js';
import { run } from './run.js';

// Brief §4.2.1 — CLI 진입점(최상위 부작용·`process.exit` 허용: STD-TS-15·STD-ERR-20).
const EXIT_SOFTWARE = 70;

function crash(e: unknown): void {
  process.stderr.write(`fathom: 내부 오류(${e instanceof Error ? e.name : 'unknown'})\n`);
  process.exit(EXIT_SOFTWARE);
}
process.on('unhandledRejection', crash);
process.on('uncaughtException', crash);

const argv = process.argv.slice(2);
if (argv.includes('--foreground')) {
  // 같은 프로세스 그룹의 supervisor가 신호를 받아 정상 종료한다 — CLI는 그 종료를 기다린다.
  const ignore = (): void => undefined;
  process.on('SIGINT', ignore);
  process.on('SIGTERM', ignore);
}
process.exit(await run(argv, realCliDeps(import.meta.url)));
