import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Banner } from '../../../src/components/banner.js';
import { Card } from '../../../src/components/card.js';
import { Panel } from '../../../src/components/panel.js';

afterEach(cleanup);

describe('Banner', () => {
  it('UT-UI-060 severity 3종은 role=status·data-severity·아이콘 + sr 텍스트를 가지며 critical 배경에 bg-danger가 없다 [FR-UX-011][NFR-AVL-005]', () => {
    const cases = [
      ['info', '안내:'],
      ['warn', '주의:'],
      ['critical', '중요:'],
    ] as const;
    for (const [severity, sr] of cases) {
      const { container, unmount } = render(<Banner severity={severity} title="알림" />);
      const el = screen.getByRole('status');
      expect(el.getAttribute('data-severity')).toBe(severity);
      expect(el.querySelector('svg')).not.toBeNull();
      expect(el.querySelector('.sr-only')?.textContent).toBe(sr);
      expect(container.firstElementChild?.className).not.toContain('bg-danger');
      unmount();
    }
  });

  it('UT-UI-061 action 1개는 클릭하면 onSelect, onDismiss는 닫기 버튼, suggest는 border-dashed이다 [FR-UX-011]', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Banner severity="info" title="알림" action={{ label: '자세히', onSelect }} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '자세히' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(<Banner severity="info" title="알림" variant="suggest" action={{ label: '이동', href: '/ai' }} />);
    expect(screen.getByRole('status').className).toContain('border-dashed');
    expect(screen.getByRole('link', { name: '이동' }).getAttribute('href')).toBe('/ai');
  });
});

describe('Card · Panel', () => {
  it('UT-UI-062 correct·incorrect·partial은 아이콘 + 텍스트 + 테두리·wash 클래스 + data-variant를 가진다 [FR-UX-011][NFR-UX-004]', () => {
    const cases = [
      ['correct', '정답', 'border-correct', 'bg-correct-wash'],
      ['incorrect', '오답', 'border-incorrect', 'bg-incorrect-wash'],
      ['partial', '부분 정답', 'border-partial', ''],
    ] as const;
    for (const [variant, text, border, wash] of cases) {
      const { container, unmount } = render(<Card variant={variant}>내용</Card>);
      const el = container.firstElementChild as HTMLElement;
      expect(el.getAttribute('data-variant')).toBe(variant);
      expect(el.className).toContain(border);
      if (wash !== '') {
        expect(el.className).toContain(wash);
      }
      expect(screen.getByText(text)).not.toBeNull();
      expect(el.querySelector('svg')).not.toBeNull();
      if (variant === 'partial') {
        expect(el.querySelector('[data-hatch]')?.getAttribute('aria-hidden')).toBe('true');
      }
      unmount();
    }
  });

  it('UT-UI-063 statusLabel이 문구를 덮어쓰고 material=popover는 rounded-popover이다 [FR-UX-011]', () => {
    const { container } = render(
      <Card variant="correct" statusLabel="맞았습니다" material="popover">
        내용
      </Card>,
    );
    expect(screen.getByText('맞았습니다')).not.toBeNull();
    expect(screen.queryByText('정답')).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('rounded-popover');
  });

  it('UT-UI-064 Panel heading은 section aria-labelledby·headingLevel·p-(--panel-p)를 반영한다 [FR-UX-011]', () => {
    const { container } = render(
      <Panel heading="요약" headingLevel={3}>
        본문
      </Panel>,
    );
    const section = container.querySelector('section') as HTMLElement;
    const h = screen.getByRole('heading', { level: 3, name: '요약' });
    expect(section.getAttribute('aria-labelledby')).toBe(h.id);
    expect(section.className).toContain('p-(--panel-p)');
  });
});
