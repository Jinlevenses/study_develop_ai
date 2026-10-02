import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildRouting,
  contractsHash,
  type EventIndex,
  type EventIndexEntry,
  GenValidationError,
  generate,
  loadManifests,
  type ManifestInput,
  MODULES,
  main,
} from '../../../scripts/gen.js';
import { COMMON_ERRORS } from '../../../src/common/errors.js';
import { S } from '../../../src/common/schema.js';
import { ACQUISITION_EVENTS } from '../../../src/events/catalog/acquisition.js';
import { AI_EVENTS } from '../../../src/events/catalog/ai.js';
import { CATALOG_EVENTS } from '../../../src/events/catalog/catalog.js';
import { GRADING_EVENTS } from '../../../src/events/catalog/grading.js';
import { ITEMBANK_EVENTS } from '../../../src/events/catalog/itembank.js';
import { LEARNING_EVENTS } from '../../../src/events/catalog/learning.js';
import { OPS_EVENTS } from '../../../src/events/catalog/ops.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { CONTRACTS_HASH, EVENT_META, EVENT_PAYLOADS } from '../../../src/events/registry.gen.js';
import { ROUTING, SUBSCRIPTIONS } from '../../../src/events/routing.gen.js';
import { AI_ERRORS } from '../../../src/http/ai-gateway/v1/errors.js';
import { CT_ERRORS } from '../../../src/http/content/v1/errors.js';
import { GW_ERRORS } from '../../../src/http/gateway/v1/errors.js';
import { LR_ERRORS } from '../../../src/http/learning/v1/errors.js';
import { OP_ERRORS } from '../../../src/http/ops/v1/errors.js';
import { ALL_ROUTES } from '../gateway/all-routes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..'); // packages/contracts
const SRC = join(ROOT, 'src');
const toPosix = (p: string): string => p.split(sep).join('/');

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFiles(p)));
    } else {
      out.push(p);
    }
  }
  return out;
}
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
// 2칸 들여쓰기 JSON·끝 줄바꿈 1개·탭 0·CR 0 (스칼라 배열은 biome 포맷처럼 한 줄에 들어가면 한 줄 — gen.ts fmtJson)
const isTwoSpaceJson = (text: string): boolean =>
  text.endsWith('}\n') &&
  !text.endsWith('\n\n') &&
  !text.includes('\t') &&
  !text.includes('\r') &&
  text.split('\n').every((l) => (l.length - l.trimStart().length) % 2 === 0);

// IF-01 §9.3 카탈로그 표 23행(type → IF-EV · 생산 · 동결 · 슬라이스) — 문서에서 뽑은 기대 목록.
const EVENTS: readonly (readonly [string, string, string, 'D' | 'O', string])[] = [
  ['catalog.pack.activated', 'IF-EV-01', 'content', 'D', 'R0'],
  ['catalog.concept.changed', 'IF-EV-02', 'content', 'D', 'R0'],
  ['catalog.overlay.conflicted', 'IF-EV-03', 'content', 'O', 'R2'],
  ['acquisition.import.staged', 'IF-EV-04', 'content', 'O', 'R2'],
  ['grading.verdict.issued', 'IF-EV-05', 'content', 'D', 'R0'],
  ['grading.verdict.revised', 'IF-EV-06', 'content', 'O', 'R2'],
  ['itembank.item.corrected', 'IF-EV-07', 'content', 'D', 'R1'],
  ['learning.evidence.recorded', 'IF-EV-08', 'learning', 'D', 'R0'],
  ['learning.session.completed', 'IF-EV-09', 'learning', 'D', 'R0'],
  ['learning.demand.forecasted', 'IF-EV-10', 'learning', 'D', 'R1'],
  ['learning.mastery.changed', 'IF-EV-11', 'learning', 'D', 'R1'],
  ['learning.level.promoted', 'IF-EV-12', 'learning', 'D', 'R1'],
  ['learning.ledger.merged', 'IF-EV-13', 'learning', 'D', 'R1'],
  ['ai.mode.changed', 'IF-EV-14', 'ai-gateway', 'D', 'R0'],
  ['ai.provider.status_changed', 'IF-EV-15', 'ai-gateway', 'O', 'R2'],
  ['ai.job.completed', 'IF-EV-16', 'ai-gateway', 'O', 'R2'],
  ['ai.work_order.approval_requested', 'IF-EV-17', 'ai-gateway', 'O', 'R2'],
  ['ai.work_order.decided', 'IF-EV-18', 'ai-gateway', 'O', 'R2'],
  ['ai.budget.threshold_reached', 'IF-EV-19', 'ai-gateway', 'O', 'R2'],
  ['ai.judge.drift_detected', 'IF-EV-20', 'ai-gateway', 'O', 'R2'],
  ['ops.health.changed', 'IF-EV-21', 'ops-api', 'D', 'R0'],
  ['ops.backup.completed', 'IF-EV-22', 'ops-api', 'D', 'R1'],
  ['ops.host_state.changed', 'IF-EV-23', 'ops-api', 'D', 'R1'],
];
const CATALOGS = [
  CATALOG_EVENTS,
  ACQUISITION_EVENTS,
  GRADING_EVENTS,
  ITEMBANK_EVENTS,
  LEARNING_EVENTS,
  AI_EVENTS,
  OPS_EVENTS,
] as const;
const MANIFEST_FILES = ['ai-gateway', 'content', 'gateway', 'learning', 'ops-api'] as const;

let files: ReadonlyMap<string, string>;
beforeAll(() => {
  files = generate();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('contracts:gen — 생성 결정성·스냅샷·레지스트리·라우팅', { timeout: 30_000 }, () => {
  it('UT-CON-220 generate() 2회 = 같은 Map(경로·내용·순서) [NFR-MAINT-006]', () => {
    const again = generate();
    expect([...again.keys()]).toEqual([...files.keys()]);
    for (const [path, content] of again) {
      expect(content === files.get(path), path).toBe(true);
    }
    expect(files.size).toBe(1101);
    // 경로는 JS 문자열 사전순, 줄바꿈은 LF
    expect([...files.keys()]).toEqual([...files.keys()].sort(byCode));
    for (const [path, content] of files) {
      expect(content.includes('\r'), path).toBe(false);
      expect(content.endsWith('\n'), path).toBe(true);
    }
  });

  it('UT-CON-221 디스크의 .snapshots/**·registry.gen.ts·routing.gen.ts = generate() 출력(누락·잉여·차이 0) [NFR-MAINT-006]', async () => {
    const onDisk = new Map<string, string>();
    for (const abs of await listFiles(join(ROOT, '.snapshots'))) {
      onDisk.set(toPosix(relative(ROOT, abs)), await readFile(abs, 'utf8'));
    }
    for (const p of ['src/events/registry.gen.ts', 'src/events/routing.gen.ts']) {
      onDisk.set(p, await readFile(join(ROOT, p), 'utf8'));
    }
    const missing = [...files.keys()].filter((p) => !onDisk.has(p));
    const extra = [...onDisk.keys()].filter((p) => !files.has(p));
    const stale = [...files.keys()].filter((p) => onDisk.has(p) && onDisk.get(p) !== files.get(p));
    expect({ missing, extra, stale }).toEqual({ missing: [], extra: [], stale: [] });
    expect(
      files
        .get('src/events/registry.gen.ts')
        ?.startsWith('// GENERATED by pnpm contracts:gen (packages/contracts/scripts/gen.ts) — DO NOT EDIT\n'),
    ).toBe(true);
    expect(
      files
        .get('src/events/routing.gen.ts')
        ?.startsWith('// GENERATED by pnpm contracts:gen (packages/contracts/scripts/gen.ts) — DO NOT EDIT\n'),
    ).toBe(true);
  });

  it('UT-CON-222 EVENT_PAYLOADS 23 type = IF-EV-01~23·값이 카탈로그 export와 같은 객체·EVENT_META 생산자 매핑 [NFR-MAINT-003]', () => {
    expect(Object.keys(EVENT_PAYLOADS).sort(byCode)).toEqual(EVENTS.map((e) => e[0]).sort(byCode));
    expect(Object.keys(EVENT_META)).toEqual(Object.keys(EVENT_PAYLOADS)); // 같은 키·같은 순서(사전순)
    expect(new Set(Object.values(EVENT_META).map((m) => m.ifId)).size).toBe(23);
    const catalog = Object.assign({}, ...CATALOGS) as Record<string, { versions: Record<number, unknown> }>;
    expect(Object.keys(catalog)).toHaveLength(23);
    for (const [type, ifId, producer, freeze, slice] of EVENTS) {
      const meta = EVENT_META[type as keyof typeof EVENT_META];
      expect(meta, type).toEqual({ ifId, producer, freeze, slice });
      const payloads = EVENT_PAYLOADS[type as keyof typeof EVENT_PAYLOADS] as Record<number, unknown>;
      expect(Object.keys(payloads), type).toEqual(['1']);
      expect(payloads[1], type).toBe(catalog[type]?.versions[1]); // 같은 객체
    }
    // type 접두 ↔ producer
    const producerOf = {
      catalog: 'content',
      acquisition: 'content',
      grading: 'content',
      itembank: 'content',
      learning: 'learning',
      ai: 'ai-gateway',
      ops: 'ops-api',
    } as const;
    for (const [type, m] of Object.entries(EVENT_META)) {
      expect(m.producer, type).toBe(producerOf[type.split('.')[0] as keyof typeof producerOf]);
    }
    expect(EVENT_META['grading.verdict.issued'].producer).toBe('content');
    expect(EVENT_META['learning.evidence.recorded'].producer).toBe('learning');
    expect(EVENT_META['ops.host_state.changed'].producer).toBe('ops-api');
  });

  it('UT-CON-223 ROUTING이 §9.5에서 도출한 기대 표와 deep equal(생산자별 소비자·mode·type 사전순) [AQ-02]', () => {
    const expected = {
      'ai-gateway': {
        content: { mode: 'durable', types: ['ai.job.completed', 'ai.mode.changed', 'ai.work_order.decided'] },
        gateway: {
          mode: 'notify',
          types: [
            'ai.budget.threshold_reached',
            'ai.judge.drift_detected',
            'ai.mode.changed',
            'ai.provider.status_changed',
            'ai.work_order.approval_requested',
            'ai.work_order.decided',
          ],
        },
        learning: { mode: 'durable', types: ['ai.mode.changed'] },
        'ops-api': {
          mode: 'durable',
          types: [
            'ai.budget.threshold_reached',
            'ai.judge.drift_detected',
            'ai.mode.changed',
            'ai.provider.status_changed',
          ],
        },
      },
      content: {
        gateway: {
          mode: 'notify',
          types: [
            'acquisition.import.staged',
            'catalog.overlay.conflicted',
            'catalog.pack.activated',
            'grading.verdict.revised',
            'itembank.item.corrected',
          ],
        },
        learning: {
          mode: 'durable',
          types: [
            'catalog.concept.changed',
            'catalog.pack.activated',
            'grading.verdict.issued',
            'grading.verdict.revised',
            'itembank.item.corrected',
          ],
        },
      },
      learning: {
        content: {
          mode: 'durable',
          types: ['learning.demand.forecasted', 'learning.evidence.recorded', 'learning.session.completed'],
        },
        gateway: {
          mode: 'notify',
          types: [
            'learning.ledger.merged',
            'learning.level.promoted',
            'learning.mastery.changed',
            'learning.session.completed',
          ],
        },
        'ops-api': {
          mode: 'durable',
          types: ['learning.ledger.merged', 'learning.level.promoted', 'learning.session.completed'],
        },
      },
      'ops-api': {
        'ai-gateway': { mode: 'durable', types: ['ops.host_state.changed'] },
        gateway: { mode: 'notify', types: ['ops.backup.completed', 'ops.health.changed'] },
        learning: { mode: 'durable', types: ['ops.host_state.changed'] },
      },
    };
    expect(ROUTING).toEqual(expected);
    expect(Object.keys(ROUTING)).toEqual(['ai-gateway', 'content', 'learning', 'ops-api']); // 키 사전순
    for (const [producer, row] of Object.entries(ROUTING)) {
      for (const [consumer, edge] of Object.entries(row)) {
        expect([...edge.types], `${producer}>${consumer}`).toEqual([...edge.types].sort(byCode));
      }
    }
    // 모든 이벤트 type이 어떤 소비자에든 한 번 이상 라우팅된다(소비자 0인 이벤트 0)
    const routed = new Set(Object.values(ROUTING).flatMap((row) => Object.values(row).flatMap((e) => [...e.types])));
    expect([...routed].sort(byCode)).toEqual(EVENTS.map((e) => e[0]).sort(byCode));
  });

  it('UT-CON-224 SUBSCRIPTIONS = 소비자 매니페스트 5개 내용 [AQ-02]', async () => {
    expect(Object.keys(SUBSCRIPTIONS)).toEqual([...MANIFEST_FILES]);
    for (const consumer of MANIFEST_FILES) {
      const json: unknown = JSON.parse(await readFile(join(SRC, 'events/__consumers__', `${consumer}.json`), 'utf8'));
      const manifest = ConsumerManifest.parse(json);
      expect(manifest.consumer).toBe(consumer);
      const generated = SUBSCRIPTIONS[consumer] as Record<string, unknown>;
      expect(Object.keys(generated), consumer).toEqual(manifest.subscriptions.map((s) => s.type).sort(byCode));
      for (const s of manifest.subscriptions) {
        expect(generated[s.type], `${consumer} ${s.type}`).toEqual({
          mode: s.mode,
          on_poison: s.on_poison,
          schema_versions: s.schema_versions,
          reads: s.reads,
        });
      }
    }
    expect(Object.values(SUBSCRIPTIONS).map((o) => Object.keys(o).length)).toEqual([1, 6, 17, 7, 7]);
  });

  it('UT-CON-225 buildRouting 음성: 없는 type·reads 없는 필드·notify+halt·소비자 0 이벤트·consumer ≠ 파일 이름·그 밖 위반 → GenValidationError [AQ-02]', () => {
    const payload = S({ a: z.string(), b: S({ c: z.number() }) });
    const entry = (producer: string, ifId = 'IF-EV-01'): EventIndexEntry => ({
      ifId,
      producer,
      freeze: 'D',
      slice: 'R0',
      versions: { 1: payload },
    });
    const events: EventIndex = new Map([['catalog.pack.activated', entry('content')]]);
    const sub = (over: Record<string, unknown> = {}) => ({
      type: 'catalog.pack.activated',
      schema_versions: [1],
      mode: 'durable' as const,
      on_poison: 'dead_letter' as const,
      reads: ['a', 'b.c'],
      ...over,
    });
    const manifest = (subs: unknown[], consumer = 'learning', file?: string): ManifestInput =>
      ({ consumer, subscriptions: subs, ...(file === undefined ? {} : { file }) }) as ManifestInput;
    const problemsOf = (fn: () => unknown): string[] => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(GenValidationError);
        return [...(e as GenValidationError).problems];
      }
      throw new Error('expected GenValidationError');
    };

    // 양성(기준선): 같은 입력으로 통과해야 아래 음성이 의미 있다
    const ok = buildRouting(events, [manifest([sub()])]);
    expect(ok.routing).toEqual({ content: { learning: { mode: 'durable', types: ['catalog.pack.activated'] } } });
    expect(ok.subscriptions).toEqual({
      learning: {
        'catalog.pack.activated': {
          mode: 'durable',
          on_poison: 'dead_letter',
          schema_versions: [1],
          reads: ['a', 'b.c'],
        },
      },
    });

    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ type: 'catalog.nope.changed' })])])).some((p) =>
        p.includes('unknown event type'),
      ),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ reads: ['a', 'zzz'] })])])).some((p) =>
        p.includes('"zzz"'),
      ),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ reads: ['b.c', 'zzz.c'] })])])).some((p) =>
        p.includes('"zzz.c"'),
      ),
    ).toBe(true);
    expect(buildRouting(events, [manifest([sub({ reads: ['*'] })])]).subscriptions.learning).toBeDefined(); // '*' 허용
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ mode: 'notify', on_poison: 'halt' })])])).some((p) =>
        p.includes('incompatible'),
      ),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ mode: 'durable', on_poison: 'drop' })])])).some((p) =>
        p.includes('incompatible'),
      ),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ mode: 'notify', on_poison: 'dead_letter' })])])).some(
        (p) => p.includes('incompatible'),
      ),
    ).toBe(true);
    expect(
      buildRouting(events, [manifest([sub({ mode: 'notify', on_poison: 'drop', reads: ['*'] })])]).routing.content
        ?.learning?.mode,
    ).toBe('notify');
    // 소비자 0인 이벤트
    const two: EventIndex = new Map([...events, ['catalog.concept.changed', entry('content', 'IF-EV-02')]]);
    expect(
      problemsOf(() => buildRouting(two, [manifest([sub()])])).some(
        (p) => p.includes('catalog.concept.changed') && p.includes('no consumer'),
      ),
    ).toBe(true);
    // consumer ≠ 파일 이름
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub()], 'learning', 'gateway.json')])).some((p) =>
        p.includes('must equal the file name'),
      ),
    ).toBe(true);
    expect(() => buildRouting(events, [manifest([sub()], 'learning', 'learning.json')])).not.toThrow();
    // 소비자 = 생산자·정의 안 된 버전·같은 (생산자, 소비자) 쌍의 mode 혼용·중복 구독·중복 매니페스트
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub()], 'content')])).some((p) =>
        p.includes('must differ from producer'),
      ),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub({ schema_versions: [1, 2] })])])).some((p) =>
        p.includes('schema_version 2'),
      ),
    ).toBe(true);
    const mixed: EventIndex = new Map([...two]);
    expect(
      problemsOf(() =>
        buildRouting(mixed, [
          manifest([sub(), sub({ type: 'catalog.concept.changed', mode: 'notify', on_poison: 'drop', reads: ['*'] })]),
        ]),
      ).some((p) => p.includes('mixes modes')),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub(), sub()])])).some((p) => p.includes('subscribed twice')),
    ).toBe(true);
    expect(
      problemsOf(() => buildRouting(events, [manifest([sub()]), manifest([sub()])])).some((p) =>
        p.includes('defined twice'),
      ),
    ).toBe(true);
    // 문제는 한꺼번에 모아서 보고한다
    expect(
      problemsOf(() =>
        buildRouting(events, [manifest([sub({ type: 'catalog.nope.changed' }), sub({ reads: ['zzz'] })])]),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('UT-CON-226 이벤트 스냅샷 경로 = .snapshots/events/<type>.v1.json 23개(T-00-06 규약)·내용 = payload z.toJSONSchema($schema 없음) [NFR-MAINT-003]', () => {
    const paths = [...files.keys()].filter((p) => p.startsWith('.snapshots/events/'));
    expect(paths).toEqual(EVENTS.map((e) => `.snapshots/events/${e[0]}.v1.json`).sort(byCode));
    expect(paths).toHaveLength(23);
    for (const [type] of EVENTS) {
      const text = files.get(`.snapshots/events/${type}.v1.json`) ?? '';
      const json = JSON.parse(text) as Record<string, unknown>;
      expect('$schema' in json, type).toBe(false);
      const { $schema: _drop, ...expected } = z.toJSONSchema(
        EVENT_PAYLOADS[type as keyof typeof EVENT_PAYLOADS][1],
      ) as Record<string, unknown>;
      expect(json, type).toEqual(expected);
      expect(isTwoSpaceJson(text), type).toBe(true);
      expect(json.type, type).toBe('object');
    }
    // check:consumers가 읽는 모양 — Verdict 스냅샷에 reads 필드가 전부 있다
    const verdict = JSON.parse(files.get('.snapshots/events/grading.verdict.issued.v1.json') ?? '{}') as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(verdict.properties)).toHaveLength(38);
  });

  it('UT-CON-227 MODULES 경로 집합 = 디스크 src/**/*.ts(*.gen.ts 제외) 집합 [NFR-MAINT-006]', async () => {
    const disk = (await listFiles(SRC))
      .map((abs) => toPosix(relative(SRC, abs)))
      .filter((p) => p.endsWith('.ts') && !p.endsWith('.gen.ts'))
      .map((p) => p.replace(/\.ts$/, ''))
      .sort(byCode);
    const listed = MODULES.map(([p]) => p);
    expect(listed).toEqual(disk); // 사전순 정렬까지 일치
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBeGreaterThan(100);
    for (const [p, ns] of MODULES) {
      expect(typeof ns, p).toBe('object');
    }
  });

  it('UT-CON-228 스키마 스냅샷: 파일 = 스키마 export 1:1·JSON 2칸·끝 줄바꿈·$schema 0 [NFR-MAINT-006]', () => {
    const expected: string[] = [];
    for (const [mod, ns] of MODULES) {
      for (const [name, value] of Object.entries(ns)) {
        if (value instanceof z.ZodType) {
          expected.push(`.snapshots/schemas/${mod}/${name}.json`);
        }
      }
    }
    const paths = [...files.keys()].filter((p) => p.startsWith('.snapshots/schemas/'));
    expect(paths).toEqual(expected.sort(byCode));
    expect(paths.length).toBeGreaterThan(500);
    for (const p of paths) {
      const text = files.get(p) ?? '';
      const json: unknown = JSON.parse(text);
      expect(isTwoSpaceJson(text), p).toBe(true);
      expect((json as Record<string, unknown>).$schema, p).toBeUndefined();
    }
    // 대표 파일(Brief 예시)
    expect(files.has('.snapshots/schemas/http/content/v1/catalog/InstallPackRequest.json')).toBe(true);
    expect(files.has('.snapshots/schemas/http/learning/v1/sessions/StartSessionBody.json')).toBe(true);
    expect(files.has('.snapshots/schemas/policy/method_policy/MethodPolicyV1.json')).toBe(true);
    expect(files.has('.snapshots/schemas/http/gateway/v1/session/Base64Url32.json')).toBe(true);
    // 값이 스키마가 아닌 export(함수·라우트·맵)는 스냅샷이 없다
    expect(files.has('.snapshots/schemas/http/learning/v1/sessions/LR_SESSIONS_ROUTES.json')).toBe(false);
    expect(files.has('.snapshots/schemas/common/pagination/Page.json')).toBe(false);
  });

  it('UT-CON-229 라우트 스냅샷 386개: properties.path.const가 정의와 같고 allowedCallers.enum = 정의 [IR-015]', () => {
    const paths = [...files.keys()].filter((p) => p.startsWith('.snapshots/routes/'));
    expect(paths).toHaveLength(386);
    expect(ALL_ROUTES).toHaveLength(386);
    for (const r of ALL_ROUTES) {
      const text = files.get(`.snapshots/routes/${r.ifId}.json`);
      expect(text, r.ifId).toBeDefined();
      const json = JSON.parse(text ?? '{}') as {
        $comment: string;
        type: string;
        properties: Record<string, Record<string, unknown>>;
      };
      expect(json.$comment, r.ifId).toBe(r.id);
      expect(json.type).toBe('object');
      expect(json.properties.path?.const, r.ifId).toBe(r.path);
      expect(json.properties.id?.const, r.ifId).toBe(r.id);
      expect(json.properties.method?.const, r.ifId).toBe(r.method);
      expect(json.properties.allowedCallers?.enum, r.ifId).toEqual([...r.allowedCallers]);
      expect(json.properties.idempotent?.const, r.ifId).toBe(r.idempotent);
      expect(json.properties.paginated?.const, r.ifId).toBe(r.paginated);
      expect(json.properties.freeze?.const, r.ifId).toBe(r.freeze);
      expect(json.properties.slice?.const, r.ifId).toBe(r.slice);
      expect(json.properties.fr?.enum, r.ifId).toEqual([...r.fr]);
      expect(json.properties.deadlineMs?.const, r.ifId).toBe(r.deadlineMs ?? null);
      expect(json.properties.bodyLimitBytes?.const, r.ifId).toBe(r.bodyLimitBytes ?? null);
      expect(json.properties.responseKind?.const, r.ifId).toBe(r.responseKind ?? 'json');
      expect(json.properties.bodyKind?.const, r.ifId).toBe(r.request.bodyKind ?? 'json');
      const reqProps = Object.keys((json.properties.request as { properties: object }).properties);
      expect(reqProps, r.ifId).toEqual(
        (['params', 'query', 'body'] as const).filter((k) => r.request[k] !== undefined),
      );
      const respProps = Object.keys((json.properties.response as { properties: object }).properties);
      expect(respProps, r.ifId).toEqual(Object.keys(r.response).sort(byCode));
      expect(Object.keys(json.properties), r.ifId).toEqual([
        'id',
        'method',
        'path',
        'allowedCallers',
        'idempotent',
        'paginated',
        'freeze',
        'slice',
        'fr',
        'deadlineMs',
        'bodyLimitBytes',
        'responseKind',
        'bodyKind',
        'request',
        'response',
      ]);
    }
    // 대표: IF-LR-081(NDJSON 본문·8 GiB), IF-GW-005(SSE), IF-GW-020(데드라인 2900)
    const imp = JSON.parse(files.get('.snapshots/routes/IF-LR-081.json') ?? '{}') as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(imp.properties.bodyKind?.const).toBe('ndjson');
    expect(imp.properties.bodyLimitBytes?.const).toBe(8_589_934_592);
    const sse = JSON.parse(files.get('.snapshots/routes/IF-GW-005.json') ?? '{}') as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(sse.properties.responseKind?.const).toBe('sse');
  });

  it('UT-CON-230 오류 스냅샷 = 서비스 92 + 공통 17(공통은 common.<CAT>-<NNN>.json) [STD-ERR-01]', () => {
    const paths = [...files.keys()].filter((p) => p.startsWith('.snapshots/errors/'));
    const common = paths.filter((p) => p.startsWith('.snapshots/errors/common.'));
    expect(common).toHaveLength(17);
    expect(paths.length - common.length).toBe(92);
    expect(paths).toHaveLength(109);
    const registries = { ...CT_ERRORS, ...LR_ERRORS, ...AI_ERRORS, ...OP_ERRORS, ...GW_ERRORS } as Record<
      string,
      { status: number; title: string; retryable: boolean }
    >;
    for (const [code, e] of Object.entries(registries)) {
      const json = JSON.parse(files.get(`.snapshots/errors/${code}.json`) ?? 'null') as {
        type: string;
        properties: Record<string, { const: unknown }>;
      };
      expect(json, code).toEqual({
        type: 'object',
        properties: { status: { const: e.status }, title: { const: e.title }, retryable: { const: e.retryable } },
      });
    }
    for (const [suffix, e] of Object.entries(COMMON_ERRORS)) {
      const json = JSON.parse(files.get(`.snapshots/errors/common.${suffix}.json`) ?? 'null') as {
        properties: Record<string, { const: unknown }>;
      };
      expect(json.properties.status?.const, suffix).toBe(e.status);
      expect(json.properties.title?.const, suffix).toBe(e.title);
      expect(json.properties.retryable?.const, suffix).toBe(e.retryable);
    }
    expect(files.has('.snapshots/errors/common.VAL-900.json')).toBe(true);
    expect(files.has('.snapshots/errors/LR-CONFLICT-020.json')).toBe(true);
  });

  it('UT-CON-231 CONTRACTS_HASH 64 hex = §4.7-5 계산과 같음·스냅샷 1바이트 바뀐 입력이면 값이 바뀜 [NFR-MAINT-006]', () => {
    expect(CONTRACTS_HASH).toMatch(/^[0-9a-f]{64}$/);
    const h = createHash('sha256');
    for (const path of [...files.keys()].filter((p) => p.startsWith('.snapshots/')).sort(byCode)) {
      h.update(Buffer.from(`${path}\0${files.get(path) ?? ''}\0`, 'utf8'));
    }
    const expected = h.digest('hex');
    expect(CONTRACTS_HASH).toBe(expected);
    expect(contractsHash(files)).toBe(expected);
    expect(files.get('src/events/registry.gen.ts')?.includes(`export const CONTRACTS_HASH = '${expected}';`)).toBe(
      true,
    );
    // 생성물 TS 2개는 해시 입력이 아니다(순환 방지) — 바꿔도 값이 같다
    const tsChanged = new Map(files);
    tsChanged.set('src/events/registry.gen.ts', `${files.get('src/events/registry.gen.ts')}\n// x`);
    expect(contractsHash(tsChanged)).toBe(expected);
    // 스냅샷 1바이트 변경 → 값이 바뀐다 / 파일 추가·삭제 → 값이 바뀐다
    const oneByte = new Map(files);
    const target = '.snapshots/routes/IF-GW-001.json';
    oneByte.set(target, `${files.get(target)} `);
    expect(contractsHash(oneByte)).not.toBe(expected);
    const removed = new Map(files);
    removed.delete(target);
    expect(contractsHash(removed)).not.toBe(expected);
    const renamed = new Map(files);
    renamed.set('.snapshots/routes/IF-GW-001b.json', renamed.get(target) ?? '');
    renamed.delete(target);
    expect(contractsHash(renamed)).not.toBe(expected);
  });

  it('UT-CON-232 main(["--check"]): 디스크와 같으면 0·임시 디렉터리에서 파일 1개를 바꾸면 1(--root <dir>) [NFR-MAINT-006]', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    expect(main(['--check'])).toBe(0); // 저장소 디스크 상태 = generate() (CT-SYS-006 선행)
    expect(out.join('')).toMatch(/^contracts:gen --check ok files=1101 hash=[0-9a-f]{12}\n$/);

    const tmp = await mkdtemp(join(tmpdir(), 'contracts-gen-'));
    try {
      for (const [path, content] of files) {
        const abs = join(tmp, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
      }
      out.length = 0;
      expect(main(['--check', '--root', tmp])).toBe(0);
      // stale(내용 1글자 변경)
      const stalePath = join(tmp, '.snapshots/routes/IF-GW-010.json');
      await writeFile(stalePath, `${files.get('.snapshots/routes/IF-GW-010.json')} `, 'utf8');
      out.length = 0;
      expect(main(['--check', '--root', tmp])).toBe(1);
      expect(out).toEqual(['stale .snapshots/routes/IF-GW-010.json\n']);
      await writeFile(stalePath, files.get('.snapshots/routes/IF-GW-010.json') ?? '', 'utf8');
      // missing
      await unlink(join(tmp, '.snapshots/errors/GW-AUTH-001.json'));
      out.length = 0;
      expect(main(['--check', '--root', tmp])).toBe(1);
      expect(out).toEqual(['missing .snapshots/errors/GW-AUTH-001.json\n']);
      await writeFile(
        join(tmp, '.snapshots/errors/GW-AUTH-001.json'),
        files.get('.snapshots/errors/GW-AUTH-001.json') ?? '',
        'utf8',
      );
      // extra + 생성물 TS 차이
      await writeFile(join(tmp, '.snapshots/events/zzz.old.v1.json'), '{}\n', 'utf8');
      await writeFile(join(tmp, 'src/events/routing.gen.ts'), '// edited by hand\n', 'utf8');
      out.length = 0;
      expect(main(['--check', '--root', tmp])).toBe(1);
      expect(out).toEqual(['stale src/events/routing.gen.ts\n', 'extra .snapshots/events/zzz.old.v1.json\n']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('UT-CON-233 main 쓰기 모드: 잉여 스냅샷 삭제·전부 기록·2회째 같은 바이트(멱등)·알 수 없는 인자 2·검증 실패 1 [NFR-MAINT-006]', async () => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    });
    const tmp = await mkdtemp(join(tmpdir(), 'contracts-gen-'));
    try {
      await mkdir(join(tmp, '.snapshots/events'), { recursive: true });
      await mkdir(join(tmp, '.snapshots/stale-dir'), { recursive: true });
      await writeFile(join(tmp, '.snapshots/events/zzz.old.v1.json'), '{}\n', 'utf8');
      await writeFile(join(tmp, '.snapshots/stale-dir/old.json'), '{}\n', 'utf8');
      expect(main(['--root', tmp])).toBe(0);
      expect(out.at(-1)).toBe(`contracts:gen files=1101 hash=${CONTRACTS_HASH.slice(0, 12)}\n`);
      const written = new Map<string, string>();
      for (const abs of await listFiles(tmp)) {
        written.set(toPosix(relative(tmp, abs)), await readFile(abs, 'utf8'));
      }
      expect([...written.keys()].sort(byCode)).toEqual([...files.keys()]); // 잉여(zzz.old·stale-dir) 삭제, 전부 기록
      for (const [p, c] of files) {
        expect(written.get(p) === c, p).toBe(true);
      }
      expect((await readdir(join(tmp, '.snapshots'))).includes('stale-dir')).toBe(false); // 빈 디렉터리 정리
      // 멱등: 2회째도 같은 바이트, --check 0
      expect(main(['--root', tmp])).toBe(0);
      expect(main(['--check', '--root', tmp])).toBe(0);
      expect(err).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    // 알 수 없는 인자 → 2(stderr 한 줄), --root 값 없음 → 2
    err.length = 0;
    expect(main(['--bogus'])).toBe(2);
    expect(err).toEqual(['contracts:gen: unknown argument --bogus\n']);
    expect(main(['--root'])).toBe(2);
    expect(main(['--check', 'extra'])).toBe(2);
  });

  it('UT-CON-234 loadManifests: 5개 파일 이름 = consumer·잘못된 JSON·스키마 위반은 문제 목록으로 보고(GenValidationError 경로) [NFR-MAINT-003]', async () => {
    const real = loadManifests();
    expect(real.problems).toEqual([]);
    expect(real.manifests.map((m) => m.file)).toEqual(MANIFEST_FILES.map((c) => `${c}.json`));
    expect(real.manifests.every((m) => m.file === `${m.consumer}.json`)).toBe(true);

    const tmp = await mkdtemp(join(tmpdir(), 'contracts-manifests-'));
    try {
      await writeFile(join(tmp, 'bad.json'), '{ not json', 'utf8');
      await writeFile(
        join(tmp, 'extra-key.json'),
        JSON.stringify({ consumer: 'content', subscriptions: [], extra: 1 }),
        'utf8',
      );
      await writeFile(join(tmp, 'gateway.json'), JSON.stringify({ consumer: 'learning', subscriptions: [] }), 'utf8');
      const r = loadManifests(tmp);
      expect(r.problems.some((p) => p.startsWith('manifest bad.json: invalid JSON'))).toBe(true);
      expect(r.problems.some((p) => p.startsWith('manifest extra-key.json:'))).toBe(true);
      // 파일 이름 ≠ consumer 는 buildRouting이 위반으로 올린다
      expect(r.manifests.map((m) => m.file)).toEqual(['gateway.json']);
      expect(() => buildRouting(new Map(), r.manifests)).toThrow(GenValidationError);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
