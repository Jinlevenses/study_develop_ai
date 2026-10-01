import { runDown } from './commands/down.js';
import { runOpen } from './commands/open.js';
import { runStatus } from './commands/status.js';
import { runUp } from './commands/up.js';
import type { Parsed } from './lib/args.js';
import { parseArgs, usage } from './lib/args.js';
import type { CliDeps } from './lib/deps.js';
import { CLI_CODES, EXIT } from './lib/exit-codes.js';
import { createOutput } from './lib/output.js';
import { readAppVersion } from './lib/preflight.js';

// Brief §4.2.1 — 명령 분기만. 모든 부작용(프로세스·파일·네트워크·출력)은 `deps`로 주입된다.
function jsonRequested(parsed: Parsed): boolean {
  return 'json' in parsed && parsed.json;
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const plain = createOutput({ stdout: deps.stdout, stderr: deps.stderr, json: false });
  if (argv.length === 0) {
    plain.info(usage(null));
    return EXIT.USAGE;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    plain.error({ code: 'CLI-VAL-001', title: `${CLI_CODES['CLI-VAL-001'].title}: ${parsed.error.message}` });
    plain.warn('`fathom --help`로 사용법을 확인하세요.');
    return EXIT.USAGE;
  }
  const p = parsed.value;
  const out = createOutput({ stdout: deps.stdout, stderr: deps.stderr, json: jsonRequested(p) });
  switch (p.kind) {
    case 'help':
      out.info(usage(p.command));
      return EXIT.OK;
    case 'version':
      out.info(await readAppVersion(deps));
      return EXIT.OK;
    case 'up':
      return runUp(p, deps, out);
    case 'open':
      return runOpen(p, deps, out);
    case 'status':
      return runStatus(p, deps, out);
    case 'down':
      return runDown(p, deps, out);
  }
}
