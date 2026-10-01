// STD-LOG-40 — CLI 사람용 출력의 유일한 통로(console 0). `--json`이면 명령 끝에 JSON 1개만 stdout에 쓴다.
// 부트스트랩 토큰(`#bt=`)이 담긴 문자열은 어떤 경로로도 출력하지 않는다(NFR-SEC-019, 방어적 invariant).
export type Writer = { write(chunk: string): unknown };
export type ProblemView = { readonly code: string; readonly title: string; readonly error_id?: string | null };

export interface Output {
  /** 사람용 안내(stdout). `--json`이면 쓰지 않는다. */
  info(text: string): void;
  /** 경고(stderr). */
  warn(text: string): void;
  /** `--json`이면 JSON 1개(stdout), 아니면 쓰지 않는다 — 사람용 출력은 `info`가 맡는다. */
  result(value: unknown): void;
  /** 오류(stderr): `오류 [<code>] <title>` + error_id. */
  error(problem: ProblemView): void;
  readonly json: boolean;
}

const SECRET_MARK = '#bt=';

function assertNoSecret(text: string): void {
  if (text.includes(SECRET_MARK)) {
    throw new Error('invariant: output must not contain a bootstrap token');
  }
}

export function createOutput(o: { stdout: Writer; stderr: Writer; json: boolean }): Output {
  return {
    json: o.json,
    info(text): void {
      assertNoSecret(text);
      if (!o.json) {
        o.stdout.write(`${text}\n`);
      }
    },
    warn(text): void {
      assertNoSecret(text);
      o.stderr.write(`${text}\n`);
    },
    result(value): void {
      const text = JSON.stringify(value);
      assertNoSecret(text);
      if (o.json) {
        o.stdout.write(`${text}\n`);
      }
    },
    error(problem): void {
      const id = problem.error_id === undefined || problem.error_id === null ? '' : ` (error_id: ${problem.error_id})`;
      const line = `오류 [${problem.code}] ${problem.title}${id}`;
      assertNoSecret(line);
      o.stderr.write(`${line}\n`);
    },
  };
}
