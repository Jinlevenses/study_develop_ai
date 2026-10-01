import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiModeChip, type AiModeValue } from '../../../src/badges/ai-mode-chip.js';
import { DataClassTag, type DataClassValue } from '../../../src/badges/data-class-tag.js';
import { JudgeBadge, type JudgeBadgeValue } from '../../../src/badges/judge-badge.js';
import { LevelBadge } from '../../../src/badges/level-badge.js';
import { ReasonChip } from '../../../src/badges/reason-chip.js';
import { StateTag, type StateTagState } from '../../../src/badges/state-tag.js';
import { StatusDot, type StatusDotState } from '../../../src/badges/status-dot.js';
import { TierTag } from '../../../src/badges/tier-tag.js';
import { TrustTag, type TrustValue } from '../../../src/badges/trust-tag.js';
import { installDomPolyfills } from '../support/dom-polyfills.js';

beforeAll(() => installDomPolyfills());
afterEach(cleanup);

const LEVELS = [1, 2, 3, 4, 5] as const;
const JUDGES: readonly Exclude<JudgeBadgeValue, 'none'>[] = [
  'ai',
  'ai_uncalibrated',
  'ai_confirm',
  'ai_estimate_confirm',
  'heuristic',
  'self',
  'pending',
];
const MODES: readonly AiModeValue[] = ['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE'];
const DOTS: readonly StatusDotState[] = ['ready', 'restarting', 'degraded', 'stopped', 'ok', 'warn', 'fail', 'skip'];
const STATES: readonly StateTagState[] = ['correct', 'partial', 'incorrect', 'pending', 'provisional', 'voided'];
const TRUSTS: readonly TrustValue[] = ['seed', 'verified', 'user', 'llm_unverified'];
const CLASSES: readonly DataClassValue[] = ['C0', 'C1', 'C2', 'C3'];

describe('LevelBadge', () => {
  it('UT-UI-080 레벨 1~5는 텍스트 L<n>·bg-depth-<n>·text-on-depth·aria-label 레벨 <n>이다 [FR-UX-007][NFR-UX-004]', () => {
    for (const n of LEVELS) {
      const { unmount } = render(<LevelBadge level={n} />);
      const el = screen.getByLabelText(`레벨 ${n}`);
      expect(el.textContent).toBe(`L${n}`);
      expect(el.className).toContain(`bg-depth-${n}`);
      expect(el.className).toContain('text-on-depth');
      unmount();
    }
  });

  it('UT-UI-081 provisional은 border-dashed·aria-label (잠정)·툴팁 잠정이다 [FR-UX-007]', () => {
    render(<LevelBadge level={3} provisional />);
    const el = screen.getByLabelText(/\(잠정\)/);
    expect(el.getAttribute('aria-label')).toBe('레벨 3 (잠정)');
    expect(el.className).toContain('border-dashed');
    fireEvent.focus(el);
    expect(screen.getByRole('tooltip').textContent).toBe('잠정');
  });
});

describe('JudgeBadge', () => {
  it('UT-UI-082 7값은 SCR §2.8 라벨 문자열과 data-badge를 가지고 none은 렌더하지 않는다 [FR-UX-007]', () => {
    const labels: Record<(typeof JUDGES)[number], string> = {
      ai: 'AI 채점',
      ai_uncalibrated: 'AI 채점 · 보정 전',
      ai_confirm: 'AI 채점 · 확인 필요',
      ai_estimate_confirm: 'AI 추정 · 확인 필요',
      heuristic: '간이 채점',
      self: '자기평가',
      pending: '채점 대기',
    };
    for (const badge of JUDGES) {
      const { container, unmount } = render(<JudgeBadge badge={badge} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.getAttribute('data-badge')).toBe(badge);
      expect(el.textContent).toBe(labels[badge]);
      unmount();
    }
    const none = render(<JudgeBadge badge="none" />);
    expect(none.container.firstChild).toBeNull();
  });

  it('UT-UI-083 7값의 테두리 패턴·아이콘이 표와 같고 상태색 클래스가 없다 [FR-UX-007][NFR-UX-004]', () => {
    const patterns = ['solid', 'dotted', 'double', 'double', 'dotted', 'solid', 'dashed'];
    JUDGES.forEach((badge, i) => {
      const { container, unmount } = render(<JudgeBadge badge={badge} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.className).toContain(`border-${patterns[i]}`);
      expect(el.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
      for (const tone of ['text-correct', 'text-incorrect', 'text-due']) {
        expect(container.innerHTML).not.toContain(tone);
      }
      unmount();
    });
  });
});

describe('AiModeChip · StatusDot', () => {
  it('UT-UI-084 AiModeChip 4모드는 라벨·점 색이 표와 같고 OFFLINE은 경고색이 아니다 [FR-UX-010]', () => {
    const want: Record<AiModeValue, [string, string]> = {
      FULL: ['AI: 전체', 'text-correct'],
      JUDGE_ONLY: ['AI: 판단만', 'text-due'],
      LLM_ONLY: ['AI: 생성만', 'text-due'],
      OFFLINE: ['AI: 오프라인', 'text-fg-subtle'],
    };
    for (const mode of MODES) {
      const { container, unmount } = render(<AiModeChip mode={mode} />);
      expect(container.textContent).toContain(want[mode][0]);
      const dot = container.querySelector('[data-dot]');
      expect(dot?.className).toContain(want[mode][1]);
      expect(dot?.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
    const off = render(<AiModeChip mode="OFFLINE" />);
    expect(off.container.innerHTML).not.toContain('text-due');
    expect(off.container.innerHTML).not.toContain('text-incorrect');
  });

  it('UT-UI-085 degraded는 border-dashed·텍스트 격하·아이콘을 가진다 [FR-UX-010][NFR-UX-004]', () => {
    const { container } = render(<AiModeChip mode="JUDGE_ONLY" degraded />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('border-dashed');
    expect(el.textContent).toContain('격하');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('UT-UI-086 StatusDot 8상태는 모양 문자·텍스트·색 클래스가 표와 같다 [NFR-AVL-005][NFR-UX-004]', () => {
    const want: Record<StatusDotState, [string, string, string]> = {
      ready: ['●', 'text-correct', '준비됨'],
      ok: ['●', 'text-correct', '정상'],
      restarting: ['◐', 'text-due', '재시작 중'],
      degraded: ['◆', 'text-due', '격하'],
      warn: ['◆', 'text-due', '주의'],
      fail: ['◆', 'text-incorrect', '오류'],
      stopped: ['○', 'text-fg-subtle', '중지됨'],
      skip: ['○', 'text-fg-subtle', '건너뜀'],
    };
    for (const state of DOTS) {
      const { container, unmount } = render(<StatusDot state={state} />);
      const shape = container.querySelector('[data-shape]') as HTMLElement;
      expect(shape.textContent).toBe(want[state][0]);
      expect(shape.className).toContain(want[state][1]);
      expect(shape.getAttribute('aria-hidden')).toBe('true');
      expect(container.textContent).toBe(`${want[state][0]}${want[state][2]}`);
      unmount();
    }
  });
});

describe('ReasonChip · StateTag', () => {
  it('UT-UI-087 ReasonChip은 label·value(num)·아이콘을 렌더하고 모르는 code는 Dot 아이콘이다 [FR-UX-007]', () => {
    const { container, rerender } = render(<ReasonChip code="due" label="복습 시점" value="R 0.71" />);
    expect(container.textContent).toContain('복습 시점');
    expect(container.textContent).toContain('R 0.71');
    expect(container.querySelector('.num')?.textContent).toBe('R 0.71');
    expect(container.querySelector('svg.lucide-arrow-up-from-line')).not.toBeNull();
    rerender(<ReasonChip code="something_new" label="새 이유" />);
    expect(container.querySelector('svg.lucide-dot')).not.toBeNull();
    rerender(<ReasonChip code="constructor" label="예약어" />);
    expect(container.querySelector('svg.lucide-dot')).not.toBeNull();
  });

  it('UT-UI-088 StateTag 6상태는 텍스트·아이콘이 표와 같고 voided는 line-through이다 [FR-UX-007][NFR-UX-004]', () => {
    const want: Record<StateTagState, [string, string]> = {
      correct: ['정답', 'lucide-check'],
      partial: ['부분 정답', 'lucide-circle-dashed'],
      incorrect: ['오답', 'lucide-x'],
      pending: ['채점 대기', 'lucide-hourglass'],
      provisional: ['잠정', 'lucide-clock'],
      voided: ['무효', 'lucide-ban'],
    };
    for (const state of STATES) {
      const { container, unmount } = render(<StateTag state={state} />);
      expect(container.textContent).toBe(want[state][0]);
      expect(container.querySelector(`svg.${want[state][1]}`)).not.toBeNull();
      unmount();
    }
    const voided = render(<StateTag state="voided" />);
    expect(screen.getByText('무효').className).toContain('line-through');
    voided.unmount();
  });

  it('UT-UI-089 partial 해칭 요소는 aria-hidden이고 pending·provisional은 border-dashed이다 [NFR-UX-004]', () => {
    const partial = render(<StateTag state="partial" />);
    expect(partial.container.querySelector('[data-hatch]')?.getAttribute('aria-hidden')).toBe('true');
    partial.unmount();
    for (const state of ['pending', 'provisional'] as const) {
      const { container, unmount } = render(<StateTag state={state} />);
      expect((container.firstElementChild as HTMLElement).className).toContain('border-dashed');
      unmount();
    }
  });
});

describe('TierTag · TrustTag · DataClassTag', () => {
  it('UT-UI-090 TierTag·TrustTag는 전 값 텍스트를 가진다 [FR-UX-007]', () => {
    for (const tier of ['A', 'B', 'C'] as const) {
      const { container, unmount } = render(<TierTag tier={tier} />);
      expect(container.textContent).toBe(`티어 ${tier}`);
      unmount();
    }
    const text: Record<TrustValue, string> = {
      seed: '시드',
      verified: '검증됨',
      user: '사용자',
      llm_unverified: 'LLM 미검증',
    };
    for (const trust of TRUSTS) {
      const { container, unmount } = render(<TrustTag trust={trust} />);
      expect(container.textContent).toBe(text[trust]);
      unmount();
    }
  });

  it('UT-UI-091 DataClassTag는 C0~C3 텍스트를 가지고 C3만 font-bold이다 [FR-UX-007]', () => {
    for (const c of CLASSES) {
      const { container, unmount } = render(<DataClassTag dataClass={c} />);
      expect(container.textContent).toBe(c);
      expect((container.firstElementChild as HTMLElement).className.includes('font-bold')).toBe(c === 'C3');
      unmount();
    }
  });
});

describe('색 단독 금지 일괄', () => {
  it('UT-UI-092 배지 9컴포넌트 x 모든 값은 비어 있지 않은 텍스트와 아이콘 또는 모양 문자를 가진다 [NFR-UX-004]', () => {
    const cases: [string, () => React.ReactElement][] = [
      ...LEVELS.map((n): [string, () => React.ReactElement] => [`level ${n}`, () => <LevelBadge level={n} />]),
      ...JUDGES.map((b): [string, () => React.ReactElement] => [`judge ${b}`, () => <JudgeBadge badge={b} />]),
      ...MODES.map((m): [string, () => React.ReactElement] => [`mode ${m}`, () => <AiModeChip mode={m} />]),
      ...DOTS.map((s): [string, () => React.ReactElement] => [`dot ${s}`, () => <StatusDot state={s} />]),
      ['reason', () => <ReasonChip code="weak" label="기초 균열" />],
      ...STATES.map((s): [string, () => React.ReactElement] => [`state ${s}`, () => <StateTag state={s} />]),
      ['tier', () => <TierTag tier="A" />],
      ['trust', () => <TrustTag trust="seed" />],
      ['class', () => <DataClassTag dataClass="C1" />],
    ];
    for (const [name, make] of cases) {
      const { container, unmount } = render(make());
      expect(container.textContent?.trim() ?? '', name).not.toBe('');
      const hasMark =
        container.querySelector('svg') !== null || container.querySelector('[data-shape], [data-dot]') !== null;
      const textOnly =
        name.startsWith('tier') || name.startsWith('trust') || name.startsWith('class') || name.startsWith('level');
      // 텍스트 전용 배지(L<n>·티어·출처·데이터 등급)는 텍스트 자체가 구분 수단이다.
      expect(hasMark || textOnly, name).toBe(true);
      unmount();
    }
  });
});
