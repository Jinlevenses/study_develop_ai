import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { showToast, Toaster } from '../../../src/components/toast.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

describe('Toaster', () => {
  it('UT-UI-059 showToast는 텍스트를 표시하고 error는 닫기 버튼이 있으며 동시 4개 중 보이는 것은 3개 이하이다 [FR-UX-010]', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      showToast({ type: 'success', title: '저장했습니다' });
    });
    flush();
    expect(screen.getByText('저장했습니다')).not.toBeNull();
    act(() => {
      showToast({ type: 'error', title: '저장하지 못했습니다', description: '다시 시도하세요' });
    });
    flush();
    expect(document.querySelector('[data-sonner-toast] [data-close-button]')).not.toBeNull();
    act(() => {
      showToast({ type: 'info', title: '안내 하나' });
      showToast({ type: 'warn', title: '주의 하나', action: { label: '보기', onSelect: () => undefined } });
    });
    flush();
    expect(document.querySelectorAll('[data-sonner-toast]').length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll('[data-sonner-toast][data-visible="true"]').length).toBeLessThanOrEqual(3);
  });
});
