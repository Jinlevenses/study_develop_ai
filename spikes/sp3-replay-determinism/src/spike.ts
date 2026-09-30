import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY, Rng, UlidGen, mixSeed, pctl, round, sha256hex } from './util.ts';
import { Simulator, DEFAULT_SIM, type Row, type FuzzMode, type SimConfig } from './sim.ts';
import { Projector, projectionHash, diffProjection, type Projection, type Envelope } from './projection.ts';
import { openLedger, Inserter, replayFromDb, verifyChains, persistProjection, loadProjection, LiveLedger, exportRows, rowToEnv } from './ledger.ts';
import { makeTuples, pushTuple, windowStats, actualLoad, forecast } from './forecast.ts';
import { ldiFull, ldiConceptFromCards } from './ldi.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DATA = process.env.SPIKE_DATA_DIR ?? path.join(ROOT, '.data');
const QUICK = process.argv.includes('--quick');
const DAYS = QUICK ? 1200 : DEFAULT_SIM.days;
const ms = (t0: number) => Math.round(performance.now() - t0);
const T00 = performance.now();
const log = (...a: any[]) => console.error('[sp3]', `t+${Math.round((performance.now() - T00) / 1000)}s`, ...a);
mkdirSync(DATA, { recursive: true });
const dbFile = (n: string) => { const p = path.join(DATA, n); for (const s of ['', '-wal', '-shm']) if (existsSync(p + s)) rmSync(p + s); return p; };

const idGen = new UlidGen(new Rng(42));
const DEV_A = idGen.next(DEFAULT_SIM.startTs), DEV_B = idGen.next(DEFAULT_SIM.startTs + 5);
const R: Record<string, any> = {};
R.env = { node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: round(os.totalmem() / 2 ** 30, 1), tz: process.env.TZ ?? '(unset)', quick: QUICK, days: DAYS, tsFsrs: '5.4.2' };
const cfgFsrs = { fuzz: false, shortTerm: true, retention: 0.9 };
const mkPr = (fuzz = false) => new Projector({ ...cfgFsrs, fuzz });

// ---------------------------------------------------------------- (1) generation time + determinism of the generator
log('1. generate-only run');
let genOnly: any;
{
  const t0 = performance.now();
  const sim = new Simulator({ deviceId: DEV_A, days: DAYS });
  let n = 0;
  sim.run(0, DAYS, () => { n++; });
  const t = ms(t0);
  genOnly = { events: n, ms: t, eventsPerSec: Math.round(n / (t / 1000)), liveHash: projectionHash(sim.proj), chainHead: sim.chain, cards: sim.proj.cards.size, concepts: sim.proj.concepts.size, corrections: sim.correctionCount, rssMB: Math.round(process.memoryUsage().rss / 2 ** 20) };
}
R.gen_only = genOnly;

// ---------------------------------------------------------------- (1b)+(2) main run: generate + persist ledger, forks for merge test
log('2. main run: generate + ledger insert (+ fork devices at divergence point)');
const D_DIV = DAYS - 60;
const mainPath = dbFile('main.db');
const mainDb = openLedger(mainPath);
const mainIns = new Inserter(mainDb);
const mainSim = new Simulator({ deviceId: DEV_A, days: DAYS });
let buf: Row[] = [], insMs = 0, nEv = 0;
const flush = () => { if (!buf.length) return; const t = performance.now(); mainIns.many(buf); insMs += performance.now() - t; buf = []; };
const sink = (row: Row) => { buf.push(row); nEv++; if (buf.length >= 20000) flush(); };
const tMain = performance.now();
mainSim.run(0, D_DIV, sink); flush();
const baseCount = Number((mainDb.prepare('SELECT count(*) c FROM events').get() as any).c);
// fork two devices from the synced state at D_DIV (both start with identical base ledger + projection)
const simA = mainSim.fork({ deviceId: DEV_A, tsQuantMs: 1000 }, true);
const simB = mainSim.fork({ deviceId: DEV_B, seed: mixSeed(DEFAULT_SIM.seed, 777), tsQuantMs: 1000, clockOffsetMs: -30 * 3_600_000, skewFromDay: D_DIV + 30 }, false);
const rowsA: Row[] = [], rowsB: Row[] = [];
simA.run(D_DIV, DAYS, (r) => rowsA.push(r));
simB.run(D_DIV, DAYS, (r) => rowsB.push(r));
mainSim.run(D_DIV, DAYS, sink); flush();
const genPersistMs = ms(tMain);
const mainLiveHash = projectionHash(mainSim.proj);
R.main_run = { events: nEv, msTotal: genPersistMs, msLedgerInsert: Math.round(insMs), msSimOnlyApprox: Math.round(genPersistMs - insMs), liveHash: mainLiveHash, chainHead: mainSim.chain, sameSeedSameLog: mainLiveHash === genOnly.liveHash && mainSim.chain === genOnly.chainHead, dbMB: Math.round(statSync(mainPath).size / 2 ** 20), baseCount };
const perYear: number[] = [];
for (const r of mainDb.prepare(`SELECT (client_ts - ${DEFAULT_SIM.startTs}) / ${365 * DAY} y, count(*) c FROM events WHERE type='review' GROUP BY y ORDER BY y`).all() as any) perYear[r.y] = r.c;
R.main_run.reviewsPerYear = perYear;
R.main_run.corrections = mainSim.correctionCount;
R.main_run.avgPayloadBytes = round(Number((mainDb.prepare('SELECT avg(length(payload)) a FROM events').get() as any).a), 1);
R.main_run.bytesPerEventOnDisk = round(statSync(mainPath).size / nEv, 1);
R.main_run.reviewsPerDayAvg = round(nEv / DAYS, 1);

// ---------------------------------------------------------------- (2) replay == live
log('3. replay from ledger only');
const prMain = mkPr();
const rep = replayFromDb(mainDb, prMain);
const repHash = projectionHash(rep.proj);
const dd = diffProjection(mainSim.proj, rep.proj);
R.replay = { events: rep.events, ms: Math.round(rep.ms), eventsPerSec: Math.round(rep.events / (rep.ms / 1000)), voidedApplied: rep.voided, replayHash: repHash, liveHash: mainLiveHash, byteEqual: repHash === mainLiveHash, cardsDiff: dd.cardDiff, conceptsDiff: dd.conceptDiff, cards: dd.cards, concepts: dd.concepts, matchPct: round(100 * (1 - (dd.cardDiff + dd.conceptDiff) / (dd.cards + dd.concepts)), 4) };
R.chain = verifyChains(mainDb);
{
  const out: Record<string, string> = {};
  for (const sql of ["UPDATE events SET client_ts=0 WHERE rowid=1", 'DELETE FROM events WHERE rowid=1']) { try { mainDb.exec(sql); out[sql] = 'NOT REJECTED'; } catch (e: any) { out[sql] = 'rejected: ' + e.message; } }
  R.append_only_triggers = out;
}
R.mastery = { concepts: rep.proj.concepts.size, masteredFlag: [...rep.proj.concepts.values()].filter((c) => c.mastered).length, note: 'Elo/mastery accuracy vs true theta is NOT validated here (sim couples ability weakly to correctness); it only gives the projection non-trivial order-dependent state.' };

// ---------------------------------------------------------------- (3) fuzz variants
log('4. fuzz variants');
async function variant(mode: FuzzMode, days: number) {
  const db = openLedger(':memory:');
  const ins = new Inserter(db);
  const sim = new Simulator({ deviceId: DEV_A, days, fuzz: mode, correctionsPerActiveDay: 0.11 });
  let b: Row[] = [];
  sim.run(0, days, (r) => { b.push(r); if (b.length >= 20000) { ins.many(b); b = []; } }); ins.many(b);
  const pr = new Projector({ ...cfgFsrs, fuzz: mode !== 'off' });
  const t0 = performance.now();
  const rp = replayFromDb(db, pr);
  const d = diffProjection(sim.proj, rp.proj);
  const out = { mode, days, events: rp.events, replayMs: ms(t0), byteEqual: projectionHash(sim.proj) === projectionHash(rp.proj), cardsDiff: d.cardDiff, cards: d.cards, conceptsDiff: d.conceptDiff };
  db.close();
  return out;
}
const fz: any[] = [];
const fdays = QUICK ? 600 : 730;
for (const m of ['off', 'embedded', 'default', 'random'] as FuzzMode[]) fz.push(await variant(m, fdays));
if (!QUICK) fz.push(await variant('embedded', DAYS));
R.fuzz_variants = fz;

// ---------------------------------------------------------------- TZ / process independence
log('5. TZ children');
const tzRes: any[] = [{ tz: '(parent, unset=UTC)', hash: repHash }];
for (const tz of ['Asia/Seoul', 'America/Los_Angeles']) {
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', 'tsx', path.join(here, 'replay-cli.ts'), mainPath], { env: { ...process.env, TZ: tz }, encoding: 'utf8', cwd: ROOT, maxBuffer: 1 << 20 });
  const j = JSON.parse(out.trim().split('\n').pop()!);
  tzRes.push({ ...j, equalToParent: j.hash === repHash });
}
R.tz_independence = tzRes;

// ---------------------------------------------------------------- (4) multi-device merge
log('6. multi-device merge');
const baseRows = exportRows(mainDb, `SELECT id,device_id,device_seq,client_ts,type,payload,card_id,concept_id FROM events WHERE rowid <= ${baseCount} ORDER BY rowid`);
const cardsA = new Set(rowsA.map((r) => r.card_id)), cardsB = new Set(rowsB.map((r) => r.card_id));
const both = [...cardsA].filter((c) => cardsB.has(c)).length;
const shuffle = <T>(a: T[], rng: Rng) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const M: Record<string, any> = { baseEvents: baseRows.length, deviceA_events: rowsA.length, deviceB_events: rowsB.length, cardsTouchedByBoth: both, divergenceDays: 60, deviceB_clockSkew: 'B clock -30h from day +30 (client_ts clamped monotonic per device)' };
// M1: base -> A -> (live A projection) -> B (incremental) ; then full replay
const p1 = dbFile('m1.db'); const db1 = openLedger(p1); const ins1 = new Inserter(db1);
ins1.many(baseRows); ins1.many(rowsA);
const cardConcept = new Map<string, string>();
for (const r of db1.prepare('SELECT card_id, min(concept_id) k FROM events WHERE card_id IS NOT NULL GROUP BY card_id').all() as any) cardConcept.set(r.card_id, r.k);
{
  const t0 = performance.now();
  const rA = replayFromDb(db1, mkPr());
  M.deviceA_localReplayEqualsLive = projectionHash(rA.proj) === projectionHash(simA.proj);
  M.deviceA_replayMs = ms(t0);
  persistProjection(db1, simA.proj, cardConcept);
}
{
  const live1 = new LiveLedger(db1, mkPr());
  const t0 = performance.now();
  const imp = live1.importRows(rowsB);
  M.incrementalImport = { ...imp, ms: ms(t0) };
  const inc = projectionHash(loadProjection(db1));
  const t1 = performance.now();
  const full1 = replayFromDb(db1, mkPr());
  const h1 = projectionHash(full1.proj);
  M.M1_A_then_B = { fullReplayMs: ms(t1), hash: h1, incrementalHash: inc, incrementalEqualsFull: inc === h1, count: Number((db1.prepare('SELECT count(*) c FROM events').get() as any).c) };
  // idempotent re-merge
  const again = live1.importRows(rowsA.concat(rowsB)); const h1b = projectionHash(loadProjection(db1));
  M.idempotentReimport = { inserted: again.inserted, projectionUnchanged: h1b === inc };
  // tie statistics
  M.crossDeviceSameTs = Number((db1.prepare('SELECT count(*) c FROM (SELECT client_ts FROM events GROUP BY client_ts HAVING count(DISTINCT device_id)>1)').get() as any).c);
  M.crossDeviceSameCardSameTs = Number((db1.prepare('SELECT count(*) c FROM (SELECT card_id,client_ts FROM events WHERE card_id IS NOT NULL GROUP BY card_id,client_ts HAVING count(DISTINCT device_id)>1)').get() as any).c);
  // negative control on M1: order by arrival (rowid)
  const t2 = performance.now();
  let arrThrows = '';
  try { replayFromDb(db1, mkPr(), { orderBy: 'rowid' }); } catch (e: any) { arrThrows = `${e.name}: ${e.message}`; }
  M.M1_rowidOrder_strictReplay = arrThrows || 'no error';
  const arr1 = replayFromDb(db1, mkPr(), { orderBy: 'rowid', tolerateNegative: true });
  M.M1_rowidOrder_negativeElapsedClamped = arr1.negClamped;
  M.M1_rowidOrder_hash = projectionHash(arr1.proj); M.M1_rowidOrder_ms = ms(t2);
  const amb1 = replayFromDb(db1, mkPr(), { orderBy: 'client_ts' });
  M.M1_ambiguousKey_hash = projectionHash(amb1.proj);
  M.M1_tieByRowid_hash = projectionHash(replayFromDb(db1, mkPr(), { orderBy: 'client_ts, rowid' }).proj);
  const dv = diffProjection(loadProjection(db1), arr1.proj); M.rowidVsTotalOrder_cardsDiffer = dv.cardDiff;
}
db1.close();
// M2: base -> B -> A
const p2 = dbFile('m2.db'); const db2 = openLedger(p2); const ins2 = new Inserter(db2);
ins2.many(baseRows); ins2.many(rowsB); ins2.many(rowsA);
{ const t0 = performance.now(); const r = replayFromDb(db2, mkPr()); M.M2_B_then_A = { fullReplayMs: ms(t0), hash: projectionHash(r.proj) };
  M.M2_ambiguousKey_hash = projectionHash(replayFromDb(db2, mkPr(), { orderBy: 'client_ts' }).proj);
  M.M2_tieByRowid_hash = projectionHash(replayFromDb(db2, mkPr(), { orderBy: 'client_ts, rowid' }).proj); }
db2.close();
// M3: everything shuffled in 5k batches with 20% duplicates (network re-delivery)
const p3 = dbFile('m3.db'); const db3 = openLedger(p3); const ins3 = new Inserter(db3);
{
  const rng = new Rng(4242);
  const all = baseRows.concat(rowsA, rowsB); const dups: Row[] = [];
  for (let i = 0; i < all.length * 0.2; i++) dups.push(all[rng.int(all.length)]);
  const mix = shuffle(all.concat(dups), rng);
  let ins = 0; for (let i = 0; i < mix.length; i += 5000) ins += ins3.many(mix.slice(i, i + 5000));
  const t0 = performance.now(); const r = replayFromDb(db3, mkPr());
  M.M3_shuffled_with_dups = { delivered: mix.length, inserted: ins, fullReplayMs: ms(t0), hash: projectionHash(r.proj) };
}
db3.close();
M.allMergeOrdersEqual = M.M1_A_then_B.hash === M.M2_B_then_A.hash && M.M2_B_then_A.hash === M.M3_shuffled_with_dups.hash && M.M1_A_then_B.incrementalEqualsFull;
M.negativeControls = { rowidOrderEqualsTotalOrder: M.M1_rowidOrder_hash === M.M1_A_then_B.hash, ambiguousKey_clientTsOnly_M1_equals_M2: M.M1_ambiguousKey_hash === M.M2_ambiguousKey_hash, tieBrokenByArrivalRowid_M1_equals_M2: M.M1_tieByRowid_hash === M.M2_tieByRowid_hash };
M.mergedDiffersFromDeviceLocalViews = projectionHash(simA.proj) !== M.M1_A_then_B.hash;
R.merge = M;

// ---------------------------------------------------------------- (5) forecast
log('7. forecast');
const cutDays = (QUICK ? [180, 365, 730, 1000, 1150] : [180, 365, 730, 1095, 1460, 1825, 2190, 2555, 2920, 3285, 3650, 4015, 4380, 4745, 5110, 5445]);
function evalForecast(label: string, replayFn: (cutoffs: number[], onCut: (c: number, p: Projection) => void, hook: any) => void, startTs: number, prF: Projector, days: number[]) {
  const tuples = makeTuples(800_000);
  const snaps = new Map<number, Map<number, any>>();
  const cuts = days.map((d) => startTs + d * DAY);
  replayFn(cuts, (c, proj) => { const m = new Map<number, any>(); for (const [id, s] of proj.cards) m.set(Number(id.slice(1)), { ...s }); snaps.set(c, m); },
    (ev: Envelope<any>, before: any) => pushTuple(tuples, ev.client_ts, before, ev.payload.rating, Number(ev.payload.card_id.slice(1))));
  const rows: any[] = [];
  for (const t0 of cuts) {
    const snap = snaps.get(t0)!;
    const cards = [...snap.values()];
    const st = windowStats(tuples, t0);
    const known = new Set<number>(snap.keys());
    const act = actualLoad(tuples, t0, 30, known);
    const activeDays = act.ex.map((x: number, i: number) => (x + act.nw[i] > 0 ? 1 : 0)).reduce((a: number, b: number) => a + b, 0);
    const A = act.ex.reduce((a: number, b: number) => a + b, 0) + act.nw.reduce((a: number, b: number) => a + b, 0);
    const AE = act.ex.reduce((a: number, b: number) => a + b, 0);
    const naive = cards.filter((c) => c.state !== 0 && c.due < t0 + 30 * DAY).length;
    const tf = performance.now();
    const fm = forecast(prF, cards, t0, 30, st, 'model'), fo = forecast(prF, cards, t0, 30, st, 'observed');
    const fms = ms(tf);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const Fm = sum(fm.ex) + sum(fm.nw), Fo = sum(fo.ex) + sum(fo.nw);
    const daily = (F: { ex: number[]; nw: number[] }) => { let e = 0, cnt = 0; for (let d = 0; d < 30; d++) { const a = act.ex[d] + act.nw[d]; if (a > 0) { e += Math.abs(F.ex[d] + F.nw[d] - a) / a; cnt++; } } return e / cnt; };
    const weekly = (F: { ex: number[]; nw: number[] }) => { let e = 0; let k = 0; for (let w = 0; w < 4; w++) { let a = 0, f = 0; for (let d = w * 7; d < w * 7 + 7; d++) { a += act.ex[d] + act.nw[d]; f += F.ex[d] + F.nw[d]; } if (a > 0) { e += Math.abs(f - a) / a; k++; } } return e / k; };
    const worst7 = (F: { ex: number[]; nw: number[] }) => { let a = 0, f = 0; for (let d = 0; d < 7; d++) { a += act.ex[d] + act.nw[d]; f += F.ex[d] + F.nw[d]; } return (f - a) / a; };
    rows.push({ day: Math.round((t0 - startTs) / DAY), activeDays, cards: cards.length, actual30: A, actualExisting: AE, actualNew: A - AE, naiveDueCount: naive, forecastModel: round(Fm, 1), forecastObserved: round(Fo, 1),
      errModel: round((Fm - A) / A, 4), errObserved: round((Fo - A) / A, 4), errNaive: round((naive - A) / A, 4), errExistingOnlyModel: round((sum(fm.ex) - AE) / Math.max(1, AE), 4),
      dailyMAPE_model: round(daily(fm), 3), weeklyMAPE_model: round(weekly(fm), 3), week1Err_model: round(worst7(fm), 3), forecastMs: fms, stats: { pFirst: round(st.pFirst, 3), pStep: round(st.pStep, 3), pReview: round(st.pReview, 3), newPerDay: round(st.newPerDay, 2) } });
  }
  const abs = (k: string) => rows.map((r) => Math.abs(r[k]));
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sub = rows.filter((r) => r.day >= 730);
  const normal = rows.filter((r) => r.activeDays >= 20);
  const summ = (k: string) => ({ meanAbs: round(mean(abs(k)), 4), maxAbs: round(Math.max(...abs(k)), 4), p90Abs: round(pctl(abs(k).sort((a, b) => a - b), 0.9), 4), within15pct: `${abs(k).filter((x) => x <= 0.15).length}/${rows.length}`, meanAbs_fromYear2: round(mean(sub.map((r) => Math.abs(r[k]))), 4), maxAbs_fromYear2: round(Math.max(...sub.map((r) => Math.abs(r[k]))), 4), within15pct_fromYear2: `${sub.filter((r) => Math.abs(r[k]) <= 0.15).length}/${sub.length}` });
  const norm = (k: string) => ({ windows: normal.length, meanAbs: round(mean(normal.map((r) => Math.abs(r[k]))), 4), maxAbs: round(Math.max(...normal.map((r) => Math.abs(r[k]))), 4), within15pct: `${normal.filter((r) => Math.abs(r[k]) <= 0.15).length}/${normal.length}` });
  const medianAbs = (k: string) => round(pctl(abs(k).sort((a, b) => a - b), 0.5), 4);
  return { label, cutoffs: rows.length, medianAbs: { model: medianAbs('errModel'), observed: medianAbs('errObserved') }, summaryWindowsWith20plusActiveDays: { model: norm('errModel'), observed: norm('errObserved') }, summary: { model: summ('errModel'), observed: summ('errObserved'), naive: summ('errNaive') }, dailyMAPE_model_mean: round(mean(rows.map((r) => r.dailyMAPE_model)), 3), weeklyMAPE_model_mean: round(mean(rows.map((r) => r.weeklyMAPE_model)), 3), rows };
}
R.forecast_main = evalForecast('main (seed 20260930, memMean .95, 15y)', (cuts, onCut, hook) => { replayFromDb(mainDb, mkPr(), { cutoffs: cuts, onCutoff: onCut, hook }); }, DEFAULT_SIM.startTs, mkPr(), cutDays);
// alternative learners (in-memory streams, single device, no corrections) to test robustness
async function altScenario(label: string, cfg: Partial<SimConfig>, days: number) {
  const sim = new Simulator({ deviceId: DEV_A, days, correctionsPerActiveDay: 0, ...cfg });
  const evs: Envelope<any>[] = [];
  sim.run(0, days, (_r, ev) => { evs.push(ev); });
  const cd = cutDays.filter((d) => d <= days - 35);
  const out = evalForecast(label, (cuts, onCut, hook) => {
    const pr = mkPr(); const proj: Projection = { cards: new Map(), concepts: new Map() }; let ci = 0;
    for (const ev of evs) { while (ci < cuts.length && ev.client_ts >= cuts[ci]) { onCut(cuts[ci], proj); ci++; } hook(ev, proj.cards.get(ev.payload.card_id)); pr.applyReview(proj, ev); }
    while (ci < cuts.length) { onCut(cuts[ci], proj); ci++; }
  }, DEFAULT_SIM.startTs, mkPr(), cd);
  return { ...out, rows: out.rows.map((r: any) => ({ day: r.day, activeDays: r.activeDays, actual30: r.actual30, forecastModel: r.forecastModel, errModel: r.errModel, errObserved: r.errObserved, errNaive: r.errNaive })) };
}
if (!QUICK) {
  R.forecast_alt = [
    await altScenario('alt1: learner forgets faster (memMean .80), seed 7, 10y', { seed: 7, memMean: 0.8 }, 3650),
    await altScenario('alt2: better memory (memMean 1.05) + less active (0.75x), seed 11, 10y', { seed: 11, memMean: 1.05, pActiveScale: 0.75 }, 3650),
  ];
}

// ---------------------------------------------------------------- (6) incremental latency on the 15y ledger
log('8. incremental latency');
const T: Record<string, any> = {};
const cardConceptMain = new Map<string, string>();
for (const r of mainDb.prepare('SELECT card_id, min(concept_id) k FROM events WHERE card_id IS NOT NULL GROUP BY card_id').all() as any) cardConceptMain.set(r.card_id, r.k);
persistProjection(mainDb, rep.proj, cardConceptMain);
const before = mainSim.eventCount;
const extra: Row[] = []; const extraEnv: Envelope<any>[] = [];
mainSim.run(DAYS, DAYS + 14, (r, ev) => { extra.push(r); extraEnv.push(ev); });
const live = new LiveLedger(mainDb, mkPr());
const tEval = extra[extra.length - 1].client_ts + 1;
const ldi0 = ldiFull(loadProjection(mainDb), cardConceptMain, tEval);
{ const t = performance.now(); ldiFull(rep.proj, cardConceptMain, tEval); T.ldiFullReadoutMs = round(performance.now() - t, 1); }
let ldiTotal = ldi0.total; const terms = new Map(ldi0.terms);
const gcs = mainDb.prepare('SELECT json FROM card_state WHERE concept_id=?'), gks = mainDb.prepare('SELECT json FROM concept_state WHERE concept_id=?');
const lat: Record<string, number[]> = { FULL: [], NORMAL: [] }; const ldiLat: number[] = [];
const paths: Record<string, number> = {};
const nFull = Math.min(300, Math.floor(extra.length / 3));
for (let i = 0; i < extra.length; i++) {
  const mode = i < nFull ? 'FULL' : 'NORMAL';
  if (i === 0) mainDb.exec('PRAGMA synchronous=FULL'); if (i === nFull) mainDb.exec('PRAGMA synchronous=NORMAL');
  const t = performance.now();
  const p = live.append(extra[i]);
  lat[mode].push(performance.now() - t); paths[p] = (paths[p] ?? 0) + 1;
  if (extra[i].type === 'review') {
    const t2 = performance.now();
    const kid = extra[i].concept_id;
    const cards = (gcs.all(kid) as any[]).map((r) => JSON.parse(r.json));
    const k = (gks.get(kid) as any); const nt = ldiConceptFromCards(kid, k ? JSON.parse(k.json) : undefined, cards, tEval);
    ldiTotal += nt - (terms.get(kid) ?? 0); terms.set(kid, nt);
    ldiLat.push(performance.now() - t2);
  }
}
const pc = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: round(pctl(s, 0.5), 3), p95: round(pctl(s, 0.95), 3), p99: round(pctl(s, 0.99), 3), max: round(s[s.length - 1], 3), mean: round(s.reduce((x, y) => x + y, 0) / s.length, 3) }; };
T.appendMs_syncNORMAL = pc(lat.NORMAL); T.appendMs_syncFULL = pc(lat.FULL); T.ldiConceptDeltaMs = pc(ldiLat); T.paths = paths;
const incProj = loadProjection(mainDb);
for (const r of mainDb.prepare('SELECT card_id, min(concept_id) k FROM events WHERE card_id IS NOT NULL GROUP BY card_id').all() as any) cardConceptMain.set(r.card_id, r.k);
const ldiFinal = ldiFull(incProj, cardConceptMain, tEval).total;
T.ldi = { incremental: ldiTotal, fullRecompute: ldiFinal, relDiff: Math.abs(ldiTotal - ldiFinal) / Math.abs(ldiFinal) };
{ const t = performance.now(); const fr = replayFromDb(mainDb, mkPr()); T.fullReplayAfterExtraMs = ms(t); T.threeWay = { persistedIncremental: projectionHash(incProj), liveSimulator: projectionHash(mainSim.proj), fullReplay: projectionHash(fr.proj) };
  T.threeWay.allEqual = T.threeWay.persistedIncremental === T.threeWay.liveSimulator && T.threeWay.liveSimulator === T.threeWay.fullReplay; T.extraEvents = extra.length; }
// late-arriving events (merge tail): events from another device with client_ts in the past -> per-key re-derive
{
  const rng = new Rng(9), ids = [...incProj.cards.keys()]; const late: Row[] = []; let chain = '0'.repeat(32); const dev = 'LATEDEV0000000000000000000';
  for (let i = 0; i < 200; i++) {
    const cid = ids[rng.int(ids.length)]; const kid = cardConceptMain.get(cid)!; const ts = tEval - Math.floor((1 + rng.next() * 20) * DAY);
    const body: any = { card_id: cid, concept_id: kid, facet: 'production', format: 'cloze', tier: 'core', rating: 3, result: 1, w_format: 0.8, w_grader: 1, gaming_factor: 1, rapid: false, latency_ms: 5000, item_beta: 0.1, grader: 'det', policy_version: 'ldi_params@v1' };
    const id = new UlidGen(new Rng(i)).next(ts); const bt = JSON.stringify(body); const h = sha256hex(`${chain}|${id}|${i + 1}|${ts}|review|${bt}`).slice(0, 32);
    late.push({ id, device_id: dev, device_seq: i + 1, client_ts: ts, type: 'review', payload: bt.slice(0, -1) + `,"prev_hash":"${chain}"}`, card_id: cid, concept_id: kid }); chain = h;
  }
  const ll: number[] = []; const pp: Record<string, number> = {};
  for (const r of late) { const t = performance.now(); const p = live.append(r); ll.push(performance.now() - t); pp[p] = (pp[p] ?? 0) + 1; }
  T.lateEventAppendMs = pc(ll); T.latePaths = pp;
  const fr = replayFromDb(mainDb, mkPr());
  T.afterLate = { persistedEqualsFullReplay: projectionHash(loadProjection(mainDb)) === projectionHash(fr.proj) };
}
R.incremental = T;

// ---------------------------------------------------------------- summary
R.criteria = {
  'gen<=60s': { ms: genOnly.ms, pass: genOnly.ms <= 60000 },
  'replay==live': R.replay.byteEqual,
  'merge order invariant': M.allMergeOrdersEqual,
  'forecast<=15% (main, model)': R.forecast_main.summary.model,
  'incremental<=1s (p99)': T.appendMs_syncFULL.p99 <= 1000,
};
writeFileSync(path.join(ROOT, QUICK ? 'results.quick.json' : 'results.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R.criteria, null, 2));
mainDb.close();
if (!process.argv.includes('--keep')) rmSync(DATA, { recursive: true, force: true });
