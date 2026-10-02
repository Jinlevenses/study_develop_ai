import { Button } from '@fathom/ui/components/button';
import type { ReactElement } from 'react';
import { copyOpenCommand } from './reconnect-screen.js';

export interface AppOffShellProps {
  /** 아직 서버로 보내지 못한 응답 수(IndexedDB 큐). */
  readonly unsent: number;
}

/** AppOffShell — Fathom이 꺼져 있을 때(네트워크 실패). 큐의 미전송 응답은 켜지면 자동 전송된다. */
export function AppOffShell({ unsent }: AppOffShellProps): ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh max-w-(--measure-read) flex-col justify-center gap-4 p-6">
      <h1 className="text-xl text-fg">Fathom이 꺼져 있습니다 — fathom open으로 켜기</h1>
      {unsent > 0 ? <p>{`보내지 못한 응답 ${String(unsent)}건은 켜지면 자동 전송됩니다`}</p> : null}
      <div>
        <Button variant="secondary" onClick={copyOpenCommand}>
          명령 복사
        </Button>
      </div>
    </main>
  );
}
