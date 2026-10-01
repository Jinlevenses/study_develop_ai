import type { WriteStream } from 'node:fs';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readdir, rm, stat, truncate, writeFile } from 'node:fs/promises';
import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { MAX_LINE_CHARS } from './child.js';

// ADR-012 §9 · STD-LOG-01·03 · CR-14 — 서비스 stdout·stderr 줄 → `logs/<svc>/YYYY-MM-DD.jsonl`(UTC 일 회전), 14일 ∧ 50MiB, 메모리 링 5,000줄.
export type LogSvc = SupervisedService | 'supervisor';
export interface LogSink {
  line(svc: LogSvc, stream: 'stdout' | 'stderr', raw: string): void;
  tail(svc: LogSvc, n: number): readonly string[];
  sweep(): Promise<void>;
  close(): Promise<void>;
}
export type LogSinkOptions = {
  readonly home: string;
  readonly clock: Clock;
  readonly foreground: boolean;
  readonly out?: { write(s: string): void };
  readonly budgetBytes?: number;
  readonly keepDays?: number;
  /** 쓰기·정리 오류 보고(STD-TS-34). 같은 종류는 1회만 — 보고 로그가 다시 싱크로 들어와 오류를 키우지 않게 한다. */
  readonly onError?: (what: string, e: unknown) => void;
};

const RING_MAX = 5000;
const SWEEP_EVERY_LINES = 1000;
const DAY_MS = 86_400_000;
const DEFAULT_BUDGET = 50 * 1024 * 1024;
const COLORS = [36, 35, 33, 32, 34, 31, 90] as const;
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isJsonObject(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** 저장·반환되는 한 줄은 래핑 뒤에도 MAX_LINE_CHARS 이하여야 한다(IF-IPC-013 `lines[i] ≤ 8000`). raw를 직렬화 길이 기준으로 줄인다. */
function wrapRaw(ts: number, level: string, svc: LogSvc, raw: string): string {
  const full = JSON.stringify({ ts, level, svc, raw });
  if (full.length <= MAX_LINE_CHARS) {
    return full;
  }
  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (JSON.stringify({ ts, level, svc, raw: raw.slice(0, mid) }).length <= MAX_LINE_CHARS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return JSON.stringify({ ts, level, svc, raw: raw.slice(0, lo) });
}

type Writer = { date: string; stream: WriteStream };

export function createLogSink(o: LogSinkOptions): LogSink {
  const budget = o.budgetBytes ?? DEFAULT_BUDGET;
  const keepDays = o.keepDays ?? 14;
  const out = o.out ?? { write: (s: string): void => void process.stdout.write(s) };
  const rings = new Map<LogSvc, string[]>();
  const writers = new Map<LogSvc, Writer>();
  const colorOf = new Map<LogSvc, number>();
  let lines = 0;
  let closed = false;
  let sweeping: Promise<void> = Promise.resolve();
  const reported = new Set<string>();
  function report(what: string, e: unknown): void {
    if (!reported.has(what)) {
      reported.add(what);
      o.onError?.(what, e);
    }
  }

  function openWriter(svc: LogSvc, date: string): Writer {
    const dir = homePath(o.home, 'logs', svc);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stream = createWriteStream(homePath(o.home, 'logs', svc, `${date}.jsonl`), { flags: 'a', mode: 0o600 });
    stream.on('error', (e: unknown) => {
      // 디스크 오류가 supervisor를 죽이지 않는다 — 링은 계속 쓰고, 깨진 writer는 버려 다음 줄에서 다시 연다.
      report(`write:${svc}`, e);
      if (writers.get(svc)?.stream === stream) {
        writers.delete(svc);
      }
    });
    return { date, stream };
  }

  function writerFor(svc: LogSvc, date: string): Writer {
    let w = writers.get(svc);
    if (w !== undefined && w.date !== date) {
      w.stream.end();
      w = undefined;
      scheduleSweep();
    }
    if (w === undefined) {
      w = openWriter(svc, date);
      writers.set(svc, w);
    }
    return w;
  }

  function scheduleSweep(): void {
    // detached: 로그 정리는 쓰기 경로를 막지 않는다. 실패는 다음 sweep이 다시 시도한다.
    sweeping = sweeping.then(doSweep).catch((e: unknown) => report('sweep', e));
  }

  async function sweepDir(svcDir: string, today: string, cutoff: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(homePath(o.home, 'logs', svcDir));
    } catch {
      return;
    }
    const files: { name: string; date: string; size: number }[] = [];
    for (const name of names) {
      const m = FILE_RE.exec(name);
      if (m === null) {
        continue;
      }
      const date = m[1] ?? '';
      const full = homePath(o.home, 'logs', svcDir, name);
      if (date < cutoff) {
        await rm(full, { force: true });
        continue;
      }
      files.push({ name, date, size: (await stat(full)).size });
    }
    files.sort((a, b) => (a.date < b.date ? -1 : 1));
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= budget) {
        break;
      }
      if (f.date === today) {
        continue; // 현재 파일은 보존
      }
      await rm(homePath(o.home, 'logs', svcDir, f.name), { force: true });
      total -= f.size;
    }
    const current = files.find((f) => f.date === today);
    if (current !== undefined && current.size > budget) {
      const note = JSON.stringify({
        ts: o.clock.now(),
        level: 'warn',
        svc: 'supervisor',
        msg: 'log truncated by budget',
      });
      const full = homePath(o.home, 'logs', svcDir, current.name);
      await truncate(full, 0);
      await writeFile(full, `${note}\n`);
    }
  }

  async function doSweep(): Promise<void> {
    const now = o.clock.now();
    const today = utcDate(now);
    const cutoff = utcDate(now - (keepDays - 1) * DAY_MS);
    let dirs: string[];
    try {
      dirs = await readdir(homePath(o.home, 'logs'));
    } catch {
      return;
    }
    for (const d of dirs) {
      await sweepDir(d, today, cutoff);
    }
  }

  return {
    line(svc, _stream, raw): void {
      const trimmed = raw.replace(/[\r\n]+$/, '');
      const text = trimmed.length > MAX_LINE_CHARS ? trimmed.slice(0, MAX_LINE_CHARS) : trimmed;
      const now = o.clock.now();
      const json = isJsonObject(text) ? text : wrapRaw(now, svc === 'vite' ? 'info' : 'fatal', svc, text);
      let ring = rings.get(svc);
      if (ring === undefined) {
        ring = [];
        rings.set(svc, ring);
      }
      ring.push(json);
      if (ring.length > RING_MAX) {
        ring.splice(0, ring.length - RING_MAX);
      }
      if (!closed) {
        try {
          writerFor(svc, utcDate(now)).stream.write(`${json}\n`);
        } catch (e) {
          report(`open:${svc}`, e); // 로그 디렉터리를 열 수 없어도 supervisor는 죽지 않는다 — 링·foreground 출력은 계속된다.
        }
        lines += 1;
        if (lines % SWEEP_EVERY_LINES === 0) {
          scheduleSweep();
        }
      }
      if (o.foreground) {
        const color = colorOf.get(svc) ?? COLORS[colorOf.size % COLORS.length] ?? 36;
        colorOf.set(svc, color);
        out.write(`\u001b[${color}m[${svc}]\u001b[0m ${json}\n`);
      }
    },
    tail(svc, n): readonly string[] {
      const ring = rings.get(svc) ?? [];
      return n >= ring.length ? [...ring] : ring.slice(ring.length - n);
    },
    sweep(): Promise<void> {
      scheduleSweep();
      return sweeping;
    },
    async close(): Promise<void> {
      closed = true;
      await sweeping;
      await Promise.all(
        [...writers.values()].map(
          (w) =>
            new Promise<void>((resolve) => {
              if (w.stream.closed) {
                resolve();
                return;
              }
              w.stream.once('close', () => resolve());
              w.stream.end();
            }),
        ),
      );
      writers.clear();
    },
  };
}
