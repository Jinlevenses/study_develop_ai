import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiOfflineNote } from '../../../src/components/ai-offline-note.js';
import { DegradedStrip } from '../../../src/components/degraded-strip.js';
import { EmptyState } from '../../../src/components/empty-state.js';
import { ErrorPanel } from '../../../src/components/error-panel.js';
import { LiveRegion } from '../../../src/components/live-region.js';
import { Meter } from '../../../src/components/meter.js';
import { Progress } from '../../../src/components/progress.js';
import { Skeleton } from '../../../src/components/skeleton.js';
import { Stepper } from '../../../src/components/stepper.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Skeleton · EmptyState', () => {
  it('UT-UI-070 Skeleton은 300ms 전 렌더 0, 이후 aria-hidden·bg-surface-3·animate 0, delayMs=0은 즉시이다 [FR-UX-011]', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<Skeleton />);
    expect(container.firstChild).toBeNull();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(container.firstChild).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('bg-surface-3');
    expect(el.className).not.toContain('animate-');
    unmount();
    const immediate = render(<Skeleton delayMs={0} shape="circle" />);
    expect(immediate.container.firstElementChild?.getAttribute('data-shape')).toBe('circle');
  });

  it('UT-UI-071 EmptyState는 제목과 버튼 정확히 1개이고 클릭하면 onSelect 1회이다 [FR-UX-011]', () => {
    const onSelect = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="비어 있습니다"
        description="첫 항목을 추가하세요"
        action={{ label: '추가', onSelect }}
      />,
    );
    expect(screen.getByText('비어 있습니다')).not.toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorPanel · DegradedStrip · AiOfflineNote', () => {
  const problem = { title: '불러오지 못했습니다', code: 'LRN-NET-001', error_id: '01J0000000000000000000ERR1' };

  it('UT-UI-072 ErrorPanel은 role=alert·code 텍스트이고 마운트 후 첫 행동 버튼에 포커스한다 [FR-UX-011]', () => {
    render(
      <ErrorPanel
        problem={problem}
        actions={[
          { label: '다시 시도', onSelect: () => undefined },
          { label: '닫기', onSelect: () => undefined },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByText('LRN-NET-001').tagName).toBe('CODE');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다시 시도' }));
  });

  it('UT-UI-073 error_id 복사 버튼은 clipboard.writeText를 1회 호출하고 error_id가 null이면 버튼이 없다 [FR-UX-011]', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { rerender } = render(
      <ErrorPanel problem={problem} actions={[{ label: '확인', onSelect: () => undefined }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '오류 ID 복사' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('01J0000000000000000000ERR1');
    rerender(
      <ErrorPanel problem={{ ...problem, error_id: null }} actions={[{ label: '확인', onSelect: () => undefined }]} />,
    );
    expect(screen.queryByRole('button', { name: '오류 ID 복사' })).toBeNull();
  });

  it('UT-UI-074 DegradedStrip은 role=status·문구·재시도 안내·다시 불러오기 클릭·border-dashed이다 [FR-UX-011][NFR-AVL-005]', () => {
    const onRetry = vi.fn();
    render(<DegradedStrip detail="learning 재시작 중" retryInSec={5} onRetry={onRetry} />);
    const el = screen.getByRole('status');
    expect(el.textContent).toContain('일부 정보를 불러오지 못했습니다(learning 재시작 중)');
    expect(el.textContent).toContain('5초 후 다시 시도');
    expect(el.className).toContain('border-dashed');
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('UT-UI-075 AiOfflineNote는 block·compact 문구가 정확하고 href 기본은 /ai이며 경고색이 없다 [FR-UX-011]', () => {
    const { container, rerender } = render(<AiOfflineNote />);
    expect(screen.getByText('AI 없이 진행 중 — 판정은 잠정/자기채점입니다')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'AI 연결' }).getAttribute('href')).toBe('/ai');
    rerender(<AiOfflineNote variant="compact" href="/settings/ai" />);
    expect(screen.getByText('AI 없이 진행 중')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'AI 연결' }).getAttribute('href')).toBe('/settings/ai');
    expect(container.innerHTML).not.toContain('text-due');
    expect(container.innerHTML).not.toContain('text-incorrect');
  });
});

describe('Progress · Meter · Stepper · LiveRegion', () => {
  it('UT-UI-076 Progress는 progressbar·aria-value*·값 클램프·tone·steps 칸을 가진다 [FR-UX-011]', () => {
    const { container, rerender } = render(<Progress label="진행" value={150} max={100} tone="session" />);
    const bar = screen.getByRole('progressbar', { name: '진행' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(container.innerHTML).toContain('bg-depth-3');
    rerender(<Progress label="진행" value={2} max={5} variant="steps" steps={5} />);
    const cells = container.querySelectorAll('[data-filled]');
    expect(cells).toHaveLength(5);
    expect(container.querySelectorAll('[data-filled="true"]')).toHaveLength(2);
  });

  it('UT-UI-077 Meter는 0.79에 아이콘 0, 0.8에 TriangleAlert·sr 주의, 1.0에 한도 도달이고 막대는 bg-fg-muted이다 [FR-UX-011][NFR-UX-004]', () => {
    const { container, rerender } = render(<Meter label="예산" value={79} max={100} />);
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Meter label="예산" value={80} max={100} />);
    expect(container.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    expect(container.querySelector('.sr-only')?.textContent).toBe('주의');
    expect(container.textContent).not.toContain('한도 도달');
    rerender(<Meter label="예산" value={100} max={100} />);
    expect(container.textContent).toContain('한도 도달');
    const meter = screen.getByRole('meter', { name: '예산' });
    expect(meter.firstElementChild?.className).toContain('bg-fg-muted');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
  });

  it('UT-UI-078 Stepper는 ol aria-label·current aria-current=step·done sr 완료이다 [FR-UX-011]', () => {
    const { container } = render(
      <Stepper
        variant="pipeline"
        aria-label="처리 단계"
        steps={[
          { id: 'a', label: '수집', state: 'done' },
          { id: 'b', label: '정리', state: 'current' },
          { id: 'c', label: '게시', state: 'todo' },
        ]}
      />,
    );
    const ol = container.querySelector('ol');
    expect(ol?.getAttribute('aria-label')).toBe('처리 단계');
    const items = screen.getAllByRole('listitem');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.getAttribute('aria-current')).toBeNull();
    expect(items[0]?.querySelector('.sr-only')?.textContent).toBe('완료');
    expect(items[2]?.textContent).toContain('3.');
  });

  it('UT-UI-079 LiveRegion은 politeness별 role·aria-live·aria-atomic·sr-only이고 message 갱신을 반영한다 [FR-UX-011][FR-UX-010]', () => {
    const { rerender } = render(<LiveRegion message="저장했습니다" />);
    const polite = screen.getByRole('status');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(polite.getAttribute('aria-atomic')).toBe('true');
    expect(polite.className).toContain('sr-only');
    expect(polite.textContent).toBe('저장했습니다');
    rerender(<LiveRegion message="다시 저장했습니다" />);
    expect(screen.getByRole('status').textContent).toBe('다시 저장했습니다');
    rerender(<LiveRegion politeness="assertive" message="오류" />);
    const assertive = screen.getByRole('alert');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    expect(assertive.getAttribute('aria-atomic')).toBe('true');
  });
});
