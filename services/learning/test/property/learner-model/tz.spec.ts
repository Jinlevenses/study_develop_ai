import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateLedger } from '../../unit/learner-model/support/generator.js';
import { MemoryResolver, runReplay, sliceHash } from '../../unit/learner-model/support/memory.js';
import { makeParams, REPO_PARAMS } from '../../unit/learner-model/support/policy.js';

const ENTRY = fileURLToPath(new URL('./fixtures/replay-hash-entry.ts', import.meta.url));
const SERVICE_DIR = fileURLToPath(new URL('../../../', import.meta.url));

function hashUnder(tz: string): Promise<{ hash: string; count: number; tz: string }> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = { TZ: tz };
    const path = process.env.PATH;
    if (path !== undefined) {
      env.PATH = path;
    }
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source', ENTRY],
      { cwd: SERVICE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const [hash, count, zone] = out.trim().split(' ');
      if (code !== 0 || hash === undefined || count === undefined) {
        reject(new Error(`child ${tz} exit ${String(code)}: ${err}`));
        return;
      }
      resolve({ hash, count: Number(count), tz: zone ?? '' });
    });
  });
}

describe('learner-model 리플레이 — 시간대 불변', () => {
  it('UT-LR-503 고정 이벤트열을 TZ=UTC·Asia/Seoul·America/Los_Angeles 자식 3개에서 리플레이 → 해시 동일 [FR-PRG-027]', async () => {
    const alt = makeParams({ fsrs: (f) => ({ ...f, request_retention: { ...f.request_retention, B: 0.8 } }) });
    const events = generateLedger(503, {
      min: 100,
      max: 120,
      policySets: [REPO_PARAMS.policy_version, alt.policy_version],
    });
    const local = sliceHash(runReplay(events, new MemoryResolver([REPO_PARAMS, alt])));
    const zones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles'];
    const results = await Promise.all(zones.map(hashUnder));
    expect(results.map((r) => r.tz)).toEqual(zones);
    for (const r of results) {
      expect(r.count).toBe(events.length);
      expect(r.hash).toBe(local);
    }
  }, 60_000);
});
