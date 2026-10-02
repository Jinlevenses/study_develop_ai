import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { colorRows } from '../../../src/features/shell/chrome/design-system/token-section.js';
import { renderApp } from './support/harness.js';

const SECTIONS = ['토큰·색', '타이포', '재질·반경·그림자', '모션', '컴포넌트', '배지'];
const JUDGE_LABELS = [
  'AI 채점',
  'AI 채점 · 보정 전',
  'AI 채점 · 확인 필요',
  'AI 추정 · 확인 필요',
  '간이 채점',
  '자기평가',
  '채점 대기',
];

describe('design page', () => {
  it('UT-WEB-454 /_design?theme=light&contrast=more는 data-theme·data-contrast만 덮어쓰고 저장하지 않으며 이탈 시 복원하고 섹션 6개·JudgeBadge 7종 라벨을 보인다 [FR-UX-002][E0-8]', async () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.contrast = 'standard';
    const app = renderApp('/_design?theme=light&contrast=more');
    await screen.findByText('디자인 시스템 · 토큰·컴포넌트 기준선');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(document.documentElement.dataset.contrast).toBe('more');
    expect(window.localStorage.getItem('fathom.theme')).toBeNull();
    expect(app.router.state.location.search).toEqual({ theme: 'light', contrast: 'more' });

    for (const title of SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: title }), title).toBeTruthy();
    }
    const badges = screen.getByRole('heading', { level: 2, name: '배지' }).closest('section');
    expect(badges).not.toBeNull();
    if (badges !== null) {
      for (const label of JUDGE_LABELS) {
        expect(within(badges).getAllByText(label).length, label).toBeGreaterThan(0);
      }
      expect(within(badges).getByText('렌더 없음')).toBeTruthy();
    }
    // 라이트 토큰 표
    const tokens = screen.getByRole('heading', { level: 2, name: '토큰·색' }).closest('section');
    expect(tokens?.textContent).toContain('라이트 테마 색 역할');
    expect(colorRows('light').find((r) => r.role === 'bg')?.value).toMatch(/^oklch\(/);
    expect(colorRows('dark').length).toBe(colorRows('light').length);

    app.utils.unmount();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.contrast).toBe('standard');
    expect(window.localStorage.getItem('fathom.theme')).toBeNull();
  });
});
