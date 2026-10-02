import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { IpcOpsToSupervisor } from '@fathom/contracts/admin/ipc';
import { describe, expect, it } from 'vitest';
import { STATUS_ROW } from './fixtures/fake-channel.js';

const CHILD = fileURLToPath(new URL('./fixtures/ipc-child.ts', import.meta.url));
const SERVICE_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const EXEC_ARGV = ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source'];

function collect(child: ChildProcess): { stdout: () => string; stderr: () => string } {
  let out = '';
  let err = '';
  child.stdout?.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  child.stderr?.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });
  return { stdout: () => out, stderr: () => err };
}

describe('supervisor IPC 클라이언트 (실제 IPC)', () => {
  it('UT-OP-198 자식이 processIpcChannel()로 status() 요청 → 부모가 status{re}로 응답 → 결과 JSON, exit 0 [IF-IPC-013][IF-IPC-014]', async () => {
    // Arrange
    const child = spawn(process.execPath, [...EXEC_ARGV, CHILD], {
      cwd: SERVICE_DIR,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });
    const io = collect(child);
    const closed = once(child, 'close');
    // Act: 부모는 요청을 받아 같은 id로 응답한다
    child.on('message', (raw: unknown) => {
      const request = IpcOpsToSupervisor.parse(raw);
      expect(request.type).toBe('status.get');
      child.send({ type: 'status', v: 1, re: request.id, services: [STATUS_ROW] });
    });
    const [code] = (await closed) as [number | null];
    // Assert
    expect(code, io.stderr()).toBe(0);
    expect(JSON.parse(io.stdout().trim())).toEqual({ ok: true, value: [STATUS_ROW] });
  });

  it('UT-OP-198 IPC 없이 spawn한 자식에서 processIpcChannel() = null [IF-IPC-013][IF-IPC-014]', async () => {
    // Arrange
    const child = spawn(process.execPath, [...EXEC_ARGV, CHILD, '--probe'], {
      cwd: SERVICE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const io = collect(child);
    // Act
    const [code] = (await once(child, 'close')) as [number | null];
    // Assert
    expect(code, io.stderr()).toBe(0);
    expect(JSON.parse(io.stdout().trim())).toEqual({ channel_is_null: true });
  });
});
