import { EmptyState } from '@fathom/ui/components/empty-state';
import { Panel } from '@fathom/ui/components/panel';
import { useNavigate } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import type { ReactElement } from 'react';

export interface RouteStubProps {
  /** SCR ID(예: `SCR-04`). 404는 빈 문자열. */
  readonly scr: string;
  readonly title: string;
  readonly notFound?: boolean;
}

/** 아직 채워지지 않은 화면 자리표시 — 행동을 강제하지 않는다(404만 `홈으로`). */
export function RouteStub({ scr, title, notFound = false }: RouteStubProps): ReactElement {
  const navigate = useNavigate();
  if (notFound) {
    return (
      <EmptyState
        icon={Compass}
        title={title}
        action={{
          label: '홈으로',
          onSelect: () => {
            void navigate({ to: '/' });
          },
        }}
      />
    );
  }
  return (
    <Panel heading={title} data-scr={scr}>
      <p>{`${scr} · 이 화면은 다음 반복에서 채워집니다.`}</p>
    </Panel>
  );
}
