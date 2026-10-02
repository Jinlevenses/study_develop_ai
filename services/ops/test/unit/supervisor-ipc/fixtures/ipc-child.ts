import { processIpcChannel } from '../../../../src/infra/supervisor-ipc/channel.js';
import { createSupervisorControl } from '../../../../src/infra/supervisor-ipc/client.js';

// UT-OP-198 자식: 실제 IPC 채널로 `status()`를 요청하고 결과를 stdout JSON 한 줄로 쓴다. `--probe`는 채널 유무만 보고한다.
const channel = processIpcChannel();
if (process.argv.includes('--probe')) {
  process.stdout.write(`${JSON.stringify({ channel_is_null: channel === null })}\n`);
} else if (channel === null) {
  process.exitCode = 3;
} else {
  const control = createSupervisorControl({ channel });
  const result = await control.status();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  control.close();
}
