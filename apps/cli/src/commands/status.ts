import type { Parsed } from '../lib/args.js';
import type { CliDeps } from '../lib/deps.js';
import { CLI_CODES, EXIT, exitForProblemCode } from '../lib/exit-codes.js';
import { readCliToken } from '../lib/gateway-client.js';
import type { RegistryFile } from '../lib/lockfile.js';
import { isRunning, readLock, readRegistry } from '../lib/lockfile.js';
import type { Output } from '../lib/output.js';
import { preflight, readAppVersion } from '../lib/preflight.js';

// FR-SET-015 — `fathom status`: gateway가 답하면 그 상태, 못 하면 레지스트리 표로 부분 표시(exit 7).
function tableRows(registry: RegistryFile): { svc: string; state: string; port: number | null; restarts: number }[] {
  return Object.entries(registry.services).flatMap(([svc, e]) =>
    e === undefined ? [] : [{ svc, state: e.state, port: e.port, restarts: e.restarts }],
  );
}

function showPartial(out: Output, registry: RegistryFile | null): number {
  const rows = registry === null ? [] : tableRows(registry);
  out.warn('gateway에서 상태를 가져오지 못해 실행 기록(registry)으로 표시합니다.');
  out.info('서비스            상태        포트   재시작');
  for (const r of rows) {
    out.info(`${r.svc.padEnd(16)}  ${r.state.padEnd(10)}  ${String(r.port ?? '-').padEnd(5)}  ${r.restarts}`);
  }
  out.result({ status: 'partial', services: rows });
  return EXIT.PARTIAL;
}

function showHuman(out: Output, body: unknown): void {
  const field = (key: string): string | null => {
    const v = typeof body === 'object' && body !== null && key in body ? Reflect.get(body, key) : undefined;
    return typeof v === 'string' ? v : null;
  };
  out.info('Fathom 실행 중');
  for (const [label, key] of [
    ['버전', 'app_version'],
    ['프로파일', 'profile'],
    ['주소', 'url'],
  ] as const) {
    const value = field(key);
    if (value !== null) {
      out.info(`${label}: ${value}`);
    }
  }
}

export async function runStatus(p: Extract<Parsed, { kind: 'status' }>, deps: CliDeps, out: Output): Promise<number> {
  const pre = await preflight(p.profile, deps, out);
  if (!pre.ok) {
    return pre.exit;
  }
  const lock = await readLock(pre.home, deps);
  if (lock === null || !isRunning(lock, deps)) {
    out.info('Fathom이 꺼져 있습니다.');
    out.result({ status: 'stopped' });
    out.error({ code: 'CLI-DEP-001', title: CLI_CODES['CLI-DEP-001'].title });
    return EXIT.NOT_RUNNING;
  }
  const registry = await readRegistry(pre.home, deps);
  const token = await readCliToken(pre.home, deps);
  if (!token.ok) {
    out.error({ code: token.error.code, title: CLI_CODES[token.error.code].title });
    return CLI_CODES[token.error.code].exit;
  }
  const port = registry?.services.gateway?.port ?? null;
  if (port === null || port === 0) {
    return showPartial(out, registry);
  }
  const res = await deps.gateway(port, token.value, await readAppVersion(deps)).get('/api/v1/cli/status');
  if (!res.ok) {
    return showPartial(out, registry);
  }
  if (res.value.problem !== null) {
    out.error(res.value.problem);
    return exitForProblemCode(res.value.problem.code);
  }
  if (res.value.status !== 200) {
    return showPartial(out, registry);
  }
  showHuman(out, res.value.body);
  out.result(res.value.body);
  return EXIT.OK;
}
