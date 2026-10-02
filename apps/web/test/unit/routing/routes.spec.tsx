import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, SAMPLE_ULID } from './support/harness.js';

const ROUTING_DIR = join(import.meta.dirname, '../../../src/routing');

const EXPECTED_FILES = [
  '__root.tsx',
  'index.tsx',
  'session.$sessionId.tsx',
  'concepts.$conceptId.tsx',
  'map.tsx',
  'evidence.$conceptId.tsx',
  'notes.$blockId.tsx',
  'dig.$dialogId.tsx',
  'cases.$runId.tsx',
  'artifacts.$runId.tsx',
  'review.weekly.tsx',
  'season.tsx',
  'inbox.tsx',
  'imports.$jobId.tsx',
  'curation.tsx',
  'ai.tsx',
  'ops.tsx',
  'settings.tsx',
  '[_]design.tsx',
];

const STUB_PATHS: readonly (readonly [string, string, string])[] = [
  ['/', 'SCR-01', '홈'],
  [`/session/${SAMPLE_ULID}`, 'SCR-02', '세션 플레이어'],
  ['/concepts/k8s.probes', 'SCR-03', '개념 페이지'],
  ['/map', 'SCR-04', '지도'],
  ['/evidence/k8s.probes', 'SCR-05', '증거 원장'],
  [`/notes/${SAMPLE_ULID}`, 'SCR-06', '백지노트'],
  [`/dig/${SAMPLE_ULID}`, 'SCR-07', '디깅'],
  [`/cases/${SAMPLE_ULID}`, 'SCR-08', 'Case'],
  [`/artifacts/${SAMPLE_ULID}`, 'SCR-09', '산출물'],
  ['/review/weekly', 'SCR-10', '주간 리뷰'],
  ['/season', 'SCR-11', '시즌'],
  ['/inbox', 'SCR-12', 'Inbox'],
  [`/imports/${SAMPLE_ULID}`, 'SCR-13', '가져오기 스테이징'],
  ['/curation', 'SCR-14', '큐레이션'],
  ['/ai', 'SCR-15', 'AI 연결·비용'],
  ['/ops', 'SCR-16', '운영 콘솔'],
  ['/settings', 'SCR-17', '설정'],
];

describe('routing', () => {
  it('UT-WEB-440 src/routing/ 파일 목록은 §4.7의 19개와 정확히 같다 [FR-UX-012]', () => {
    expect(readdirSync(ROUTING_DIR).sort()).toEqual([...EXPECTED_FILES].sort());
    expect(readdirSync(ROUTING_DIR)).toHaveLength(19);
  });

  it('UT-WEB-441 DN-10: /_design은 파일 라우트로 매치되고 DesignSystemPage가 렌더된다 [FR-UX-002][SCR-18]', async () => {
    const app = renderApp('/_design');
    await screen.findByText('디자인 시스템 · 토큰·컴포넌트 기준선');
    const matches = app.router.state.matches;
    expect(matches.at(-1)?.fullPath).toBe('/_design');
    expect(matches.at(-1)?.routeId).toBe('/_design');
    expect(app.router.routesByPath['/_design']).toBeDefined();
  });

  it('UT-WEB-442 17개 화면 경로와 /_design은 404 없이 로드되고 RouteStub의 SCR ID가 일치하며 알 수 없는 경로는 404 안내다 [FR-UX-012]', async () => {
    for (const [path, scr, title] of STUB_PATHS) {
      const app = renderApp(path);
      await screen.findByText(`${scr} · 이 화면은 다음 반복에서 채워집니다.`);
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(screen.queryByText('페이지를 찾을 수 없습니다')).toBeNull();
      app.utils.unmount();
    }
    const nope = renderApp('/nope/never');
    await screen.findByText('페이지를 찾을 수 없습니다');
    expect(screen.getByRole('button', { name: '홈으로' })).toBeTruthy();
    nope.utils.unmount();
    const design = renderApp('/_design');
    await screen.findByText('디자인 시스템 · 토큰·컴포넌트 기준선');
    design.utils.unmount();
  });

  it('UT-WEB-443 라우트별 validateSearch는 유효 샘플을 통과시키고 미지 키·enum 밖 값은 {}로 바꾼다 [FR-DSH-004]', async () => {
    const app = renderApp('/', { startSse: false });
    await waitFor(() => expect(app.router.state.status).toBe('idle'));
    const validate = (path: string, raw: Record<string, unknown>): unknown => {
      const route: unknown = Object.entries(app.router.routesByPath).find(([p]) => p === path)?.[1];
      const options =
        typeof route === 'object' && route !== null && 'options' in route
          ? (route.options as Record<string, unknown>)
          : {};
      const fn = options.validateSearch;
      if (typeof fn !== 'function') {
        throw new Error(`${path}: validateSearch 없음`);
      }
      return fn(raw);
    };
    const CASES: readonly (readonly [string, Record<string, unknown>])[] = [
      ['/', { onboarding: 1 }],
      [`/session/$sessionId`, { b: SAMPLE_ULID, view: 'report' }],
      ['/concepts/$conceptId', { tab: 'code', lens: 3, edit: 1, src: 1 }],
      [
        '/map',
        {
          track: 'k8s',
          layers: 'mastery,retention',
          as_of: 1_790_000_000_000,
          bp: 'cert-cka@2026',
          view: 'table',
          focus: 'k8s.probes',
          panel: 'paths',
        },
      ],
      ['/evidence/$conceptId', { tab: 'events' }],
      ['/review/weekly', { week: '2026-W40', tab: 'radar' }],
      ['/inbox', { tab: 'imports', state: 'open' }],
      ['/curation', { tab: 'conflicts', state: 'a', flag: 'b' }],
      ['/ai', { tab: 'work_orders' }],
      ['/ops', { tab: 'backups', cid: SAMPLE_ULID }],
      ['/settings', { section: 'keys' }],
      ['/_design', { theme: 'light', contrast: 'more' }],
    ];
    for (const [path, raw] of CASES) {
      const got = validate(path, raw);
      expect(got, path).toBeDefined();
      expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(raw).sort());
      expect(validate(path, { ...raw, bogus_key: 'x' }), `${path} 미지 키`).toEqual({});
    }
    // 변환 확인
    expect(validate('/', { onboarding: 1 })).toEqual({ onboarding: '1' });
    expect(validate('/concepts/$conceptId', { lens: '3' })).toEqual({ lens: 3 });
    expect(validate('/map', { track: 'all' })).toEqual({ track: 'all' });
    // enum·형식 밖 값
    const BAD: readonly (readonly [string, Record<string, unknown>])[] = [
      [`/session/$sessionId`, { view: 'nope' }],
      ['/concepts/$conceptId', { lens: 9 }],
      ['/map', { layers: 'mastery,nope' }],
      ['/map', { layers: 'Mastery' }],
      ['/map', { track: 'zzz' }],
      ['/review/weekly', { week: '2026-40' }],
      ['/inbox', { state: 'x'.repeat(41) }],
      ['/curation', { tab: 'other' }],
      ['/ai', { tab: 'other' }],
      ['/ops', { cid: 'not-a-ulid' }],
      ['/settings', { section: 'other' }],
      ['/_design', { theme: 'sepia' }],
      ['/_design', { contrast: 'less' }],
      ['/', { onboarding: 2 }],
    ];
    for (const [path, raw] of BAD) {
      expect(validate(path, raw), `${path} ${JSON.stringify(raw)}`).toEqual({});
    }
  });
});
