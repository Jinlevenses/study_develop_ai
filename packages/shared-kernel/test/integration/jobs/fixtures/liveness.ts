import { readFile } from 'node:fs/promises';

/** 프로세스가 살아 있는지. 좀비(컨테이너 PID 1이 수확하지 않은 종료 프로세스)는 죽은 것으로 본다. */
export async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
      return false;
    }
    throw e;
  }
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return !/^\d+ \(.*\) Z /.test(stat);
    } catch {
      return false;
    }
  }
  return true;
}
