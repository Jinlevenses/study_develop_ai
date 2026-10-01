import type { Parsed } from '../lib/args.js';
import type { CliDeps } from '../lib/deps.js';
import type { Running } from '../lib/ensure-running.js';
import { ensureRunning } from '../lib/ensure-running.js';
import { CLI_CODES, EXIT } from '../lib/exit-codes.js';
import type { Output } from '../lib/output.js';
import { preflight } from '../lib/preflight.js';
import { openSession } from '../lib/session.js';

// FR-SET-001 · ADR-012 §6 — `fathom up`: 켜고(이미 켜져 있으면 그대로), 토큰을 받아 브라우저를 연다.
export function announce(out: Output, running: Running): void {
  const url = `http://127.0.0.1:${running.port}/`;
  out.info(`Fathom 실행 중: ${url}`);
  for (const notice of running.notices) {
    const port = notice.split(':')[2] ?? String(running.port);
    out.info(`안내: 기본 포트를 쓸 수 없어 ${port} 포트로 실행합니다.`);
  }
  if (running.degraded.length > 0) {
    out.warn(
      `경고: 일부 서비스가 정상이 아닙니다(${running.degraded.join(', ')}). 자세한 원인은 \`fathom doctor\`로 확인하세요.`,
    );
  }
  out.result({
    status: running.degraded.length > 0 ? 'degraded' : 'running',
    url,
    already: running.already,
    degraded: running.degraded,
    notices: running.notices,
  });
}

export async function runUp(p: Extract<Parsed, { kind: 'up' }>, deps: CliDeps, out: Output): Promise<number> {
  const pre = await preflight(p.profile, deps, out);
  if (!pre.ok) {
    return pre.exit;
  }
  const running = await ensureRunning(deps, out, {
    profile: p.profile,
    home: pre.home,
    safe: p.safe,
    foreground: p.foreground,
    logLevel: p.logLevel,
    entries: p.entries,
  });
  if (!running.ok) {
    out.warn(`원인: ${running.error.detail}`);
    out.warn('자세한 진단은 `fathom doctor`를 실행해 주세요.');
    out.error({ code: running.error.code, title: CLI_CODES[running.error.code].title });
    return running.error.exit;
  }
  if (!p.noOpen) {
    const session = await openSession(deps, out, {
      home: pre.home,
      port: running.value.port,
      purpose: 'up',
      noOpen: false,
    });
    if (!session.ok) {
      return session.exit;
    }
  }
  announce(out, running.value);
  if (p.foreground && running.value.exited !== null) {
    return (await running.value.exited) === 0 ? EXIT.OK : EXIT.FAILED;
  }
  return running.value.degraded.length > 0 ? EXIT.PARTIAL : EXIT.OK;
}
