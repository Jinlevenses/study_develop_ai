import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { Parsed } from '../lib/args.js';
import type { CliDeps } from '../lib/deps.js';
import { EXIT } from '../lib/exit-codes.js';
import { readCliToken } from '../lib/gateway-client.js';
import { isRunning, readLock, readRegistry } from '../lib/lockfile.js';
import type { Output } from '../lib/output.js';
import { preflight, readAppVersion } from '../lib/preflight.js';

// FR-SET-015 · ADR-012 §8 — `fathom down`: gateway `/cli/shutdown`(202) → 안 되면 supervisor pid에 종료 신호 → pid 사망 대기(≤ 15s).
export const DOWN_WAIT_MS = 15_000;
const POLL_MS = 100;
const GRACE_MS = 3000;

async function waitGone(deps: CliDeps, pid: number): Promise<boolean> {
  const deadline = deps.clock.now() + DOWN_WAIT_MS;
  while (deps.isAlive(pid)) {
    if (deps.clock.now() >= deadline) {
      return false;
    }
    await deps.sleep(POLL_MS);
  }
  return true;
}

export async function runDown(p: Extract<Parsed, { kind: 'down' }>, deps: CliDeps, out: Output): Promise<number> {
  const pre = await preflight(p.profile, deps, out);
  if (!pre.ok) {
    return pre.exit;
  }
  const lock = await readLock(pre.home, deps);
  if (lock === null || !isRunning(lock, deps)) {
    out.info('실행 중이 아닙니다.');
    out.result({ status: 'not_running' });
    return EXIT.OK;
  }
  let accepted = false;
  const token = await readCliToken(pre.home, deps);
  const registry = await readRegistry(pre.home, deps);
  const port = registry?.services.gateway?.port ?? null;
  if (token.ok && port !== null && port !== 0) {
    const key = ulid();
    const res = await deps
      .gateway(port, token.value, await readAppVersion(deps))
      .post('/api/v1/cli/shutdown', { op_id: key, grace_ms: GRACE_MS }, key);
    accepted = res.ok && res.value.status === 202;
  }
  if (!accepted) {
    // pid 재사용 방어 — registry가 같은 supervisor(boot_id·pid)를 가리킬 때만 신호를 보낸다.
    if (registry === null || registry.boot_id !== lock.boot_id || registry.supervisor_pid !== lock.pid) {
      out.warn(
        'supervisor 정보(lock·registry)가 일치하지 않아 종료 신호를 보내지 않았습니다. 작업 관리자에서 확인해 주세요.',
      );
      return EXIT.FAILED;
    }
    if (!(await deps.killPid(lock.pid))) {
      out.warn('종료 신호를 보내지 못했습니다.');
    }
  }
  if (!(await waitGone(deps, lock.pid))) {
    out.warn('종료하지 못했습니다. 잠시 뒤 다시 시도하거나 작업 관리자에서 확인해 주세요.');
    return EXIT.FAILED;
  }
  out.info('Fathom을 종료했습니다.');
  out.result({ status: 'stopped' });
  return EXIT.OK;
}
