import type { Parsed } from '../lib/args.js';
import type { CliDeps } from '../lib/deps.js';
import { ensureRunning } from '../lib/ensure-running.js';
import { CLI_CODES, EXIT } from '../lib/exit-codes.js';
import type { Output } from '../lib/output.js';
import { preflight } from '../lib/preflight.js';
import { openSession } from '../lib/session.js';
import { announce } from './up.js';

// FR-SET-023 · UC-36 — `fathom open`: 브라우저를 연다. 꺼져 있으면 먼저 켠다.
export async function runOpen(p: Extract<Parsed, { kind: 'open' }>, deps: CliDeps, out: Output): Promise<number> {
  const pre = await preflight(p.profile, deps, out);
  if (!pre.ok) {
    return pre.exit;
  }
  const running = await ensureRunning(deps, out, {
    profile: p.profile,
    home: pre.home,
    safe: false,
    foreground: false,
    logLevel: 'info',
    entries: p.entries,
  });
  if (!running.ok) {
    out.warn(`원인: ${running.error.detail}`);
    out.warn('자세한 진단은 `fathom doctor`를 실행해 주세요.');
    out.error({ code: running.error.code, title: CLI_CODES[running.error.code].title });
    return running.error.exit;
  }
  const session = await openSession(deps, out, {
    home: pre.home,
    port: running.value.port,
    purpose: 'open',
    noOpen: p.noOpen,
  });
  if (!session.ok) {
    return session.exit;
  }
  announce(out, running.value);
  return running.value.degraded.length > 0 ? EXIT.PARTIAL : EXIT.OK;
}
