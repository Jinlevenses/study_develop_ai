import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { createFakeClock } from '@fathom/testkit/clock';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogSink } from '../../../src/supervisor/log-sink.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 21, 14, 13, 20); // 2026-09-21T14:13:20Z
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmpHome(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'fathom-sink-'));
  dirs.push(d);
  return d;
}
const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
async function files(home: string, svc: string): Promise<string[]> {
  try {
    return (await readdir(path.join(home, 'logs', svc))).sort();
  } catch {
    return [];
  }
}
async function seed(home: string, svc: string, ms: number, bytes: number): Promise<string> {
  const dir = path.join(home, 'logs', svc);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${dateOf(ms)}.jsonl`);
  await writeFile(file, 'x'.repeat(bytes));
  return file;
}

describe('로그 싱크', () => {
  it('UT-SUP-007 sweep: 오늘−14일 삭제·오늘−13일 보존, 예산 초과 시 오래된 파일부터 삭제(현재 파일 보존), 현재 파일 단독 초과 → truncate + 경고 줄 [NFR-AVL-007][CR-14]', async () => {
    const home = await tmpHome();
    const clock = createFakeClock(T0);
    await seed(home, 'content', T0 - 14 * DAY, 10);
    await seed(home, 'content', T0 - 13 * DAY, 10);
    await seed(home, 'content', T0 - 2 * DAY, 400);
    await seed(home, 'content', T0 - 1 * DAY, 400);
    await seed(home, 'learning', T0, 100);
    const sink = createLogSink({ home, clock, foreground: false, budgetBytes: 500 });
    await sink.sweep();
    expect(await files(home, 'content')).toEqual([`${dateOf(T0 - 1 * DAY)}.jsonl`]); // 14일 밖 삭제 → 예산 초과분 오래된 순 삭제
    expect(await files(home, 'learning')).toEqual([`${dateOf(T0)}.jsonl`]);

    const keep = await tmpHome();
    await seed(keep, 'content', T0 - 14 * DAY, 10);
    await seed(keep, 'content', T0 - 13 * DAY, 10);
    await createLogSink({ home: keep, clock, foreground: false }).sweep();
    expect(await files(keep, 'content')).toEqual([`${dateOf(T0 - 13 * DAY)}.jsonl`]);

    const big = await tmpHome();
    const current = await seed(big, 'content', T0, 2000);
    await createLogSink({ home: big, clock, foreground: false, budgetBytes: 500 }).sweep();
    const lines = (await readFile(current, 'utf8')).split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'warn',
      svc: 'supervisor',
      msg: 'log truncated by budget',
    });
  });

  it('UT-SUP-050 JSON 줄은 원문 그대로 통과 [NFR-AVL-007][STD-LOG-03]', async () => {
    const home = await tmpHome();
    const sink = createLogSink({ home, clock: createFakeClock(T0), foreground: false });
    const raw = '{"level":"info","svc":"content","msg":"hello","ts":1}';
    sink.line('content', 'stdout', raw);
    await sink.close();
    const [name] = await files(home, 'content');
    expect(name).toBe(`${dateOf(T0)}.jsonl`);
    expect(await readFile(path.join(home, 'logs', 'content', name ?? ''), 'utf8')).toBe(`${raw}\n`);
  });

  it('UT-SUP-051 비 JSON 줄 → {level:fatal, svc, raw}(vite는 info), 배열·스칼라 JSON도 감싼다 [NFR-AVL-007][STD-LOG-03]', async () => {
    const home = await tmpHome();
    const sink = createLogSink({ home, clock: createFakeClock(T0), foreground: false });
    sink.line('learning', 'stderr', 'Segmentation fault (core dumped)');
    sink.line('learning', 'stdout', '[1,2]');
    sink.line('vite', 'stdout', 'VITE v8 ready in 300 ms');
    expect(sink.tail('learning', 10).map((l) => JSON.parse(l))).toEqual([
      { ts: T0, level: 'fatal', svc: 'learning', raw: 'Segmentation fault (core dumped)' },
      { ts: T0, level: 'fatal', svc: 'learning', raw: '[1,2]' },
    ]);
    expect(JSON.parse(sink.tail('vite', 1)[0] ?? '{}')).toMatchObject({ level: 'info', svc: 'vite' });
    const long = 'z'.repeat(9000);
    sink.line('content', 'stderr', long);
    const stored = sink.tail('content', 1)[0] ?? '';
    expect(stored.length).toBeLessThanOrEqual(8000); // 래핑 뒤에도 IF-IPC-013 한도
    expect((JSON.parse(stored) as { raw: string }).raw.length).toBeGreaterThan(7900);
    await sink.close();
  });

  it('UT-SUP-059 저장·반환되는 줄은 래핑·이스케이프 뒤에도 ≤ 8,000자·유효 JSON, 로그 디렉터리를 열 수 없어도 죽지 않고 1회 보고 [NFR-AVL-007][STD-LOG-03]', async () => {
    const home = await tmpHome();
    const sink = createLogSink({ home, clock: createFakeClock(T0), foreground: false });
    const cases = [
      'q'.repeat(20_000),
      '"'.repeat(5000),
      '\\'.repeat(5000),
      '한'.repeat(9000),
      `{"a":"${'x'.repeat(9000)}"}`, // 8,000자에서 잘려 깨진 JSON
      `{"a":"${'y'.repeat(7900)}"}`, // 한도 안의 JSON은 원문 그대로
    ];
    for (const text of cases) {
      sink.line('content', 'stderr', text);
    }
    const stored = sink.tail('content', 10);
    expect(stored).toHaveLength(cases.length);
    for (const line of stored) {
      expect(line.length).toBeLessThanOrEqual(8000);
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(stored[5]).toBe(cases[5]);
    expect((JSON.parse(stored[0] ?? '{}') as { raw: string }).raw.startsWith('qqq')).toBe(true);
    await sink.close();
    for (const name of await files(home, 'content')) {
      const text = await readFile(path.join(home, 'logs', 'content', name), 'utf8');
      expect(text.split('\n').every((l) => l.length <= 8000)).toBe(true);
    }

    const blocked = await tmpHome();
    await mkdir(path.join(blocked, 'logs'), { recursive: true });
    await writeFile(path.join(blocked, 'logs', 'content'), 'not a directory');
    const errors: string[] = [];
    const bad = createLogSink({
      home: blocked,
      clock: createFakeClock(T0),
      foreground: false,
      onError: (what) => void errors.push(what),
    });
    bad.line('content', 'stdout', '{"a":1}');
    bad.line('content', 'stdout', '{"a":2}');
    expect(bad.tail('content', 5)).toHaveLength(2); // 링은 계속 쓴다
    expect(errors).toEqual(['open:content']); // 같은 종류는 1회만
    await bad.close();
  });

  it('UT-SUP-052 UTC 날짜가 바뀌면 이전 스트림을 닫고 새 파일에 쓴다 [NFR-AVL-007]', async () => {
    const home = await tmpHome();
    const clock = createFakeClock(Date.UTC(2026, 8, 21, 23, 59, 59));
    const sink = createLogSink({ home, clock, foreground: false });
    sink.line('content', 'stdout', '{"a":1}');
    clock.advance(2000); // 2026-09-22T00:00:01Z
    sink.line('content', 'stdout', '{"a":2}');
    await sink.close();
    expect(await files(home, 'content')).toEqual(['2026-09-21.jsonl', '2026-09-22.jsonl']);
    expect(await readFile(path.join(home, 'logs', 'content', '2026-09-22.jsonl'), 'utf8')).toBe('{"a":2}\n');
    expect((await stat(path.join(home, 'logs', 'content', '2026-09-21.jsonl'))).mode & 0o777).toBe(0o600);
  });

  it('UT-SUP-053 서비스별 메모리 링 5,000줄·tail(n) [NFR-AVL-007]', async () => {
    const home = await tmpHome();
    const sink = createLogSink({ home, clock: createFakeClock(T0), foreground: false });
    for (let i = 0; i < 5100; i++) {
      sink.line('content', 'stdout', `{"i":${i}}`);
    }
    sink.line('learning', 'stdout', '{"other":true}');
    expect(sink.tail('content', 99_999)).toHaveLength(5000);
    expect(sink.tail('content', 2)).toEqual(['{"i":5098}', '{"i":5099}']);
    expect(sink.tail('content', 0)).toEqual([]);
    expect(sink.tail('learning', 5)).toEqual(['{"other":true}']);
    expect(sink.tail('gateway', 5)).toEqual([]);
    await sink.close();
  });

  it('UT-SUP-054 foreground면 [svc] 접두어로 터미널에도 출력 [NFR-AVL-007][AP-12]', async () => {
    const home = await tmpHome();
    const out: string[] = [];
    const sink = createLogSink({
      home,
      clock: createFakeClock(T0),
      foreground: true,
      out: { write: (s) => void out.push(s) },
    });
    sink.line('content', 'stdout', '{"msg":"a"}');
    sink.line('gateway', 'stdout', '{"msg":"b"}');
    await sink.close();
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('[content]');
    expect(out[0]).toContain('{"msg":"a"}');
    expect(out[0]?.startsWith('\u001b[')).toBe(true);
    expect(out[1]).toContain('[gateway]');
  });

  it('UT-SUP-055 detached(foreground=false)면 stdout 출력 0 [NFR-AVL-007]', async () => {
    const home = await tmpHome();
    const out: string[] = [];
    const sink = createLogSink({
      home,
      clock: createFakeClock(T0),
      foreground: false,
      out: { write: (s) => void out.push(s) },
    });
    sink.line('content', 'stdout', '{"msg":"a"}');
    await sink.close();
    expect(out).toEqual([]);
  });

  it('UT-SUP-056 supervisor 자신의 로그가 logs/supervisor/로 간다 [NFR-AVL-007][STD-LOG-03]', async () => {
    const home = await tmpHome();
    const clock = createFakeClock(T0);
    const sink = createLogSink({ home, clock, foreground: false });
    const log = createLogger('supervisor', {
      level: 'info',
      bootId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      clock,
      destination: { write: (c: string): void => sink.line('supervisor', 'stdout', c.trimEnd()) },
    });
    log.info({ event: 'supervisor.start' }, 'hello');
    await sink.close();
    const text = await readFile(path.join(home, 'logs', 'supervisor', `${dateOf(T0)}.jsonl`), 'utf8');
    expect(JSON.parse(text.trim())).toMatchObject({
      svc: 'supervisor',
      level: 'info',
      event: 'supervisor.start',
      msg: 'hello',
      ts: T0,
    });
  });
});
