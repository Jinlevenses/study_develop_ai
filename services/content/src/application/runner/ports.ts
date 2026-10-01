// runner BC 포트 — ADR-007 §2 코드 블록 전사. 위치는 `application/<bc>/ports.ts`(grading·itembank가 `import type`으로 쓰는 유일한 자리, T-00-12 §10 ④).
export interface RunRequest {
  kind: 'code' | 'sql';
  lang?: 'js' | 'ts';
  code: string; // code ≤ 64KB
  sourceKind: 'learner' | 'seed' | 't1'; // 그 밖(t3·t4·imported·llm) → 'rejected' 403
  harness?: { mode: 'hidden_tests' | 'stdout_compare' | 'complexity'; ref: string };
  timeoutMs?: number; // JS/TS 3000, SQL 2000
  rssLimitMB?: number; // 256
  outCapBytes?: number; // 65536 — 판정은 stdout+stderr 합 >= outCapBytes
  writableTmp?: boolean; // false(과제 opt-in)
  netns?: boolean; // Linux 선택 하드닝(unshare -Urn)
}
export type RunStatus =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'memory_limit'
  | 'output_limit'
  | 'rejected'
  | 'platform_disabled'
  | `killed_${string}`;
export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr: string /* 러너 경로 치환 후 */;
  exitCode: number | null;
  durationMs: number;
  peakRssMB: number;
  outputTruncated: boolean;
  reason?: string;
  harness?: {
    passed: number;
    failed: number;
    cases: { id: string; ok: boolean }[];
    complexity?: { slope: number; method: 'ops' | 'cpu' };
  };
}

export interface RunnerPort {
  run(req: RunRequest, opts?: { readonly signal?: AbortSignal }): Promise<RunResult>;
  /** `runner_verified_platforms` 대조(ADR-007 §7). */
  platformEnabled(): { readonly enabled: boolean; readonly reason: string | null };
}
