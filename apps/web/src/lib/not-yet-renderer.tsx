import { EmptyState } from '@fathom/ui/components/empty-state';
import { useNavigate } from '@tanstack/react-router';
import { Construction } from 'lucide-react';
import type { ReactElement } from 'react';

export interface NotYetRendererProps {
  readonly blockId: string;
  readonly itemKey: string | null;
  /** 레지스트리 키(FormatId ∪ BlockKind) — 플레이어가 `RENDERERS[key]`를 렌더할 때 함께 넘긴다. */
  readonly rendererKey?: string;
}

/** 아직 구현되지 않은 렌더러 자리표시 — feature WP가 `RENDERERS`의 component 값을 교체한다. */
export function NotYetRenderer({ itemKey, rendererKey }: NotYetRendererProps): ReactElement {
  const navigate = useNavigate();
  const key = rendererKey ?? itemKey ?? undefined;
  return (
    <div data-renderer-key={key}>
      <EmptyState
        icon={Construction}
        title="이 형식은 아직 준비 중입니다"
        description={key}
        action={{
          label: '세션 목록으로',
          onSelect: () => {
            void navigate({ to: '/' });
          },
        }}
      />
    </div>
  );
}
