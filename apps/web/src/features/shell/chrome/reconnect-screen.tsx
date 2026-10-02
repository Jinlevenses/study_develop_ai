import { Button } from '@fathom/ui/components/button';
import type { ReactElement } from 'react';

export const OPEN_COMMAND = 'fathom open';

/** 클립보드 복사 — 실패는 조용히 무시한다(권한·비보안 컨텍스트). */
export function copyOpenCommand(): void {
  try {
    void Promise.resolve(navigator.clipboard?.writeText(OPEN_COMMAND)).catch(() => undefined);
  } catch {
    // 클립보드를 쓸 수 없는 환경 — 사용자가 직접 입력할 수 있도록 명령은 화면에 그대로 보인다.
  }
}

/** ST-SESSION-LOST — 브라우저 세션이 끊겼을 때(SCR §2.2). */
export function ReconnectScreen(): ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh max-w-(--measure-read) flex-col justify-center gap-4 p-6">
      <h1 className="text-xl text-fg">브라우저 세션이 끊겼습니다.</h1>
      <p>
        터미널에서 <code>{OPEN_COMMAND}</code>을 실행하면 바로 이어집니다.
      </p>
      <div>
        <Button variant="secondary" onClick={copyOpenCommand}>
          명령 복사
        </Button>
      </div>
    </main>
  );
}
