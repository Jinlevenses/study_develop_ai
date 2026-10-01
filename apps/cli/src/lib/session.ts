import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { CliDeps } from './deps.js';
import { CLI_CODES, EXIT, exitForProblemCode } from './exit-codes.js';
import { pickOpenUrl, readCliToken } from './gateway-client.js';
import type { Output } from './output.js';
import { readAppVersion } from './preflight.js';

// IF-GW-001 · IR-014 · Brief §4.2.7 — 부트스트랩 토큰을 발급받아 브라우저를 연다. URL의 `#bt=`는 터미널·로그·JSON 어디에도 출력하지 않는다.
export type SessionResult = { readonly ok: true } | { readonly ok: false; readonly exit: number };

export async function openSession(
  deps: CliDeps,
  out: Output,
  o: { readonly home: string; readonly port: number; readonly purpose: 'up' | 'open'; readonly noOpen: boolean },
): Promise<SessionResult> {
  const token = await readCliToken(o.home, deps);
  if (!token.ok) {
    out.error({ code: token.error.code, title: CLI_CODES[token.error.code].title });
    return { ok: false, exit: CLI_CODES[token.error.code].exit };
  }
  const client = deps.gateway(o.port, token.value, await readAppVersion(deps));
  const res = await client.post('/api/v1/cli/bootstrap-token', { purpose: o.purpose }, ulid());
  if (!res.ok) {
    if (res.error.kind === 'connect') {
      out.error({ code: 'CLI-DEP-001', title: CLI_CODES['CLI-DEP-001'].title });
      return { ok: false, exit: EXIT.NOT_RUNNING };
    }
    out.warn(`오류: gateway가 응답하지 않습니다(${res.error.kind})`);
    return { ok: false, exit: EXIT.FAILED };
  }
  if (res.value.problem !== null) {
    out.error(res.value.problem);
    return { ok: false, exit: exitForProblemCode(res.value.problem.code) };
  }
  const url = res.value.status === 201 ? pickOpenUrl(res.value.body) : null;
  if (url === null || !url.ok) {
    out.warn('오류: gateway의 응답을 해석할 수 없습니다');
    return { ok: false, exit: EXIT.FAILED };
  }
  if (o.noOpen) {
    return { ok: true };
  }
  if (!(await deps.openBrowser(url.value, o.home))) {
    out.warn('브라우저를 열지 못했습니다 — 다시 `fathom open`을 실행해 주세요.');
    return { ok: false, exit: EXIT.FAILED };
  }
  return { ok: true };
}
