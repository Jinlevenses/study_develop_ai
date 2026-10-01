import { readdir, readFile, readlink } from 'node:fs/promises';

// TST-01 §8.3 L2 — `/proc` 표본기(Linux 전용). 스택 하위 전 pid의 소켓 inode를 `/proc/net/*`와 대조해 비 loopback 원격 주소를 모은다.

export type SocketFamily = 'tcp' | 'tcp6' | 'udp' | 'udp6';

export type SocketRow = {
  readonly family: SocketFamily;
  readonly localAddress: string;
  readonly localPort: number;
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly state: string;
  readonly inode: number;
};

export type EgressReport = {
  readonly samples: number;
  readonly remotes: readonly { pid: number; remote: string; state: string }[];
};

export interface EgressSampler {
  /** 지금까지의 보고(타이머는 계속 돈다). */
  snapshot(): EgressReport;
  stop(): Promise<EgressReport>;
}

const TCP_STATES: Readonly<Record<string, string>> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
};

/** `/proc/net/*`의 hex 주소(워드 단위 리틀엔디언) → 문자열. */
function decodeAddress(hex: string): string {
  const bytes: number[] = [];
  for (let word = 0; word < hex.length; word += 8) {
    for (let i = 6; i >= 0; i -= 2) {
      bytes.push(Number.parseInt(hex.slice(word + i, word + i + 2), 16));
    }
  }
  if (bytes.length === 4) {
    return bytes.join('.');
  }
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `::ffff:${bytes.slice(12).join('.')}`;
  }
  return compressIpv6(groups);
}

function compressIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) {
      j += 1;
    }
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) {
    return hex.join(':');
  }
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

/** `/proc/net/{tcp,tcp6,udp,udp6}` 본문 → 행(헤더·형식 불량 줄 제외). 순수 함수. */
export function parseProcNet(text: string, family: SocketFamily): SocketRow[] {
  const rows: SocketRow[] = [];
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    const local = cols[1]?.split(':');
    const remote = cols[2]?.split(':');
    const stateHex = cols[3];
    const inodeText = cols[9];
    if (
      local?.length !== 2 ||
      remote?.length !== 2 ||
      stateHex === undefined ||
      inodeText === undefined ||
      !/^\d+$/.test(inodeText)
    ) {
      continue;
    }
    const [localHex, localPortHex] = local;
    const [remoteHex, remotePortHex] = remote;
    if (
      localHex === undefined ||
      localPortHex === undefined ||
      remoteHex === undefined ||
      remotePortHex === undefined
    ) {
      continue;
    }
    const upper = stateHex.toUpperCase();
    rows.push({
      family,
      localAddress: decodeAddress(localHex),
      localPort: Number.parseInt(localPortHex, 16),
      remoteAddress: decodeAddress(remoteHex),
      remotePort: Number.parseInt(remotePortHex, 16),
      state: TCP_STATES[upper] ?? upper,
      inode: Number(inodeText),
    });
  }
  return rows;
}

/** 127.0.0.0/8 · `::1` · IPv4 매핑 loopback · `localhost`. */
export function isLoopback(addr: string): boolean {
  const lower = addr.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(lower) ||
    /^::ffff:127(\.\d{1,3}){3}$/.test(lower)
  );
}

function isUnspecified(addr: string): boolean {
  return addr === '0.0.0.0' || addr === '::' || addr === '::ffff:0.0.0.0';
}

function isMissing(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    'code' in cause &&
    ['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'ENOTDIR'].includes(String(cause.code))
  );
}

async function tolerate<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch (cause) {
    if (isMissing(cause)) {
      return fallback; // 표본 중 프로세스가 끝났거나 권한이 없다
    }
    throw cause;
  }
}

async function childrenOf(pid: number): Promise<number[]> {
  const tasks = await tolerate(readdir(`/proc/${pid}/task`), []);
  const out: number[] = [];
  for (const task of tasks) {
    const text = await tolerate(readFile(`/proc/${pid}/task/${task}/children`, 'utf8'), '');
    for (const token of text.split(/\s+/)) {
      if (/^\d+$/.test(token)) {
        out.push(Number(token));
      }
    }
  }
  return out;
}

async function descendants(rootPid: number): Promise<number[]> {
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined) {
      break;
    }
    for (const child of await childrenOf(pid)) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

async function socketInodes(pid: number): Promise<Set<number>> {
  const inodes = new Set<number>();
  const fds = await tolerate(readdir(`/proc/${pid}/fd`), []);
  for (const fd of fds) {
    const target = await tolerate(readlink(`/proc/${pid}/fd/${fd}`), '');
    const match = /^socket:\[(\d+)\]$/.exec(target);
    if (match?.[1] !== undefined) {
      inodes.add(Number(match[1]));
    }
  }
  return inodes;
}

const FAMILIES: readonly SocketFamily[] = ['tcp', 'tcp6', 'udp', 'udp6'];

async function readSocketTable(): Promise<SocketRow[]> {
  const rows: SocketRow[] = [];
  for (const family of FAMILIES) {
    rows.push(...parseProcNet(await tolerate(readFile(`/proc/net/${family}`, 'utf8'), ''), family));
  }
  return rows;
}

/** 루트 pid와 그 하위 전 pid의 소켓을 주기적으로 표본해 비 loopback 원격 주소를 모은다. 타이머는 `unref`. */
export function startEgressSampler(opts: { rootPid: number; intervalMs?: number }): EgressSampler {
  const intervalMs = opts.intervalMs ?? 50;
  const found = new Map<string, { pid: number; remote: string; state: string }>();
  let samples = 0;
  let inFlight: Promise<void> | null = null;

  async function sampleOnce(): Promise<void> {
    const pids = await descendants(opts.rootPid);
    const owners = new Map<number, number>(); // inode → pid
    for (const pid of pids) {
      for (const inode of await socketInodes(pid)) {
        owners.set(inode, pid);
      }
    }
    for (const row of await readSocketTable()) {
      const pid = owners.get(row.inode);
      if (pid === undefined || row.state === 'LISTEN' || isUnspecified(row.remoteAddress)) {
        continue;
      }
      if (isLoopback(row.remoteAddress)) {
        continue;
      }
      const remote = row.family.endsWith('6')
        ? `[${row.remoteAddress}]:${row.remotePort}`
        : `${row.remoteAddress}:${row.remotePort}`;
      found.set(`${pid} ${remote} ${row.state}`, { pid, remote, state: row.state });
    }
    samples += 1;
  }

  function tick(): void {
    if (inFlight !== null) {
      return; // 이전 표본이 아직 진행 중
    }
    inFlight = sampleOnce().finally(() => {
      inFlight = null;
    });
    inFlight.catch(() => undefined); // 표본 실패는 다음 틱에서 다시 시도한다(stop()의 마지막 표본은 오류를 던진다)
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref();

  const report = (): EgressReport => ({ samples, remotes: [...found.values()] });

  return {
    snapshot: report,
    async stop(): Promise<EgressReport> {
      clearInterval(timer);
      if (inFlight !== null) {
        await inFlight.catch(() => undefined);
      }
      await sampleOnce();
      return report();
    },
  };
}
