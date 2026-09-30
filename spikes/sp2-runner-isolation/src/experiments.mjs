import { run, RUN_ROOT } from './runner.mjs';
import { startServices, makeCtx } from './harness.mjs';
import { attacks } from './attacks.mjs';

export async function watchdogOvershoot(log = () => {}) {
  const res = [];
  const shapes = {
    single_1GB_touch: 'const b=Buffer.alloc(1e9,1); console.log(b.length)',
    incremental_16MB: 'const a=[]; for(;;){a.push(Buffer.alloc(16<<20,1));}',
    heap_arrays: 'const a=[]; for(;;){a.push(new Array(1e6).fill(1));}',
  };
  for (const interval of [100, 50, 25]) {
    for (const [shape, code] of Object.entries(shapes)) {
      const peaks = []; const stat = {};
      for (let i = 0; i < 5; i++) {
        const r = await run({ code, asMB: 0, watchIntervalMs: interval, timeoutMs: 8000, maxOldSpaceMB: 4096 });
        peaks.push(r.peakRssMB); stat[r.status] = (stat[r.status] || 0) + 1;
      }
      res.push({ intervalMs: interval, shape, statuses: stat, peakSampledRssMB: peaks, max: Math.max(...peaks) });
      log(`watchdog ${interval}ms ${shape}: ${JSON.stringify(stat)} peaks ${peaks.join(',')}`);
    }
  }
  return res;
}

export async function premiseChecks(log = () => {}) {
  const out = {};
  // P2: --max-old-space-size does not cap Buffer; nothing but watchdog/rlimit does. rss watchdog effectively disabled here (rssLimit 8GB).
  const r = await run({ code: 'const b=Buffer.alloc(1.2e9,1); console.log("held", b.length, process.memoryUsage().rss>>20)', layers: 'permission', asMB: 0, rssLimitMB: 8192, maxOldSpaceMB: 128, timeoutMs: 8000 });
  out.P2_heapFlagDoesNotCapBuffer = { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.slice(0, 120) };
  log('P2 ' + JSON.stringify(out.P2_heapFlagDoesNotCapBuffer));
  // P5: RLIMIT_AS catches the same allocation cleanly
  const r2 = await run({ code: 'try{const b=Buffer.alloc(1.2e9,1); console.log("held")}catch(e){console.log("ALLOC-FAIL",e.code||e.message)}', asMB: 1024 });
  out.P5_rlimitAsBlocksBigBuffer = { status: r2.status, stdout: r2.stdout.trim() };
  log('P5 ' + JSON.stringify(out.P5_rlimitAsBlocksBigBuffer));
  // P6: unshare -Urn network namespace removes ALL network even without the JS guard
  const svc = await startServices(); const ctx = makeCtx(svc.ports);
  const ids = ['NET-01', 'NET-03', 'NET-04', 'NET-06', 'NET-07', 'NET-10'];
  const rows = [];
  for (const id of ids) {
    const a = attacks(ctx).find((x) => x.id === id);
    const before = { ...svc.hits };
    const rr = await run({ code: a.code, layers: 'permission', netns: true, timeoutMs: 4000 });
    await new Promise((r3) => setTimeout(r3, 100));
    const hit = svc.hits.tcp + svc.hits.http + svc.hits.udp - (before.tcp + before.http + before.udp);
    rows.push({ id, hits: hit, stdout: rr.stdout.trim().slice(0, 100), status: rr.status, spawnError: rr.spawnError, stderr: rr.stderr.slice(0, 100) });
  }
  svc.close();
  out.P6_netnsWithoutGuard = rows;
  log('P6 ' + JSON.stringify(rows.map((x) => [x.id, x.hits, x.stdout])));
  return out;
}
