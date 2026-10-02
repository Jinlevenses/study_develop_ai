import { AiModeChip } from '@fathom/ui/badges/ai-mode-chip';
import { Popover, PopoverContent, PopoverTrigger } from '@fathom/ui/components/popover';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useHomeView, useSseSnapshot } from './use-shell-data.js';

const SENTENCE = {
  FULL: 'AI가 채점과 생성을 모두 돕고 있습니다.',
  JUDGE_ONLY: 'AI가 채점만 돕고 있습니다. 새 문항 생성은 쉽니다.',
  LLM_ONLY: 'AI가 생성만 돕고 있습니다. 채점은 결정적 방식으로 진행됩니다.',
  OFFLINE: 'AI 없이 진행 중입니다. 판정은 잠정 또는 자기채점입니다.',
} as const;

/** 모든 라우트에 보이는 AI 모드 칩(FR-UX-010 [T]) — 모드는 홈 뷰 값이 우선, 없으면 SSE 값(기본 OFFLINE). */
export function AiChip(): ReactElement {
  const home = useHomeView();
  const sse = useSseSnapshot();
  const mode = home.data?.ai_chip.mode ?? sse.aiMode;
  const degraded = home.data?.ai_chip.degraded_badge ?? false;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-pill" aria-label="AI 상태">
          <AiModeChip mode={mode} degraded={degraded} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-2 text-sm">
          <span>{SENTENCE[mode]}</span>
          <Link to="/ai" className="underline underline-offset-4">
            AI 연결 설정
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
