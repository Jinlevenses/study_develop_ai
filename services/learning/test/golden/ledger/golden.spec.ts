import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import {
  GOLDEN_SETS,
  goldenLedgerPath,
  goldenMetaPath,
  readGoldenLedger,
  readGoldenMeta,
} from '@fathom/testkit/golden-ledgers/golden-ledgers';
import { describe, expect, it } from 'vitest';
import { parseLedgerJsonl } from '../../../src/application/ledger/jsonl.js';
import { rootHash, verifyAnchor } from '../../../src/domain/ledger/chain/anchor.js';
import { verifyChains } from '../../../src/domain/ledger/chain/verify.js';
import { compareTotalOrder } from '../../../src/domain/ledger/order/total-order.js';
import { studyDayOf } from '../../../src/domain/ledger/time/study-day.js';
import { NODE_HASH_PORT } from '../../../src/infra/ledger/hash-port.js';
import { GOLDEN_SPECS, generateGoldenSet } from './generate-golden.js';
import { GOLDEN_STUDY_DAY } from './payloads.js';

// CR-65 골든 원장 3세트(basic·two-device·corrections). freeze_at INT-1b — 바이트 변경은 CR-65 트레일러가 있는 커밋만.
const SLOW = 120_000;
const SERVICE_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const GENERATOR = fileURLToPath(new URL('./generate-golden.ts', import.meta.url));
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const byDeviceSeq = (events: readonly LedgerEventEnvelope[]): LedgerEventEnvelope[] =>
  [...events].sort((a, b) =>
    a.device_id === b.device_id ? a.device_seq - b.device_seq : a.device_id < b.device_id ? -1 : 1,
  );

describe('골든 원장', () => {
  it('UT-LR-610 3세트: 체인 검증 0 위반·meta·헤더 앵커 일치 [NFR-DATA-003][FR-PRG-003]', () => {
    for (const set of GOLDEN_SETS) {
      const { header, events, footer } = readGoldenLedger(set);
      const meta = readGoldenMeta(set);
      const report = verifyChains(NODE_HASH_PORT, byDeviceSeq(events));
      expect(report.breaks, set).toEqual([]);
      expect(report.events, set).toBe(meta.events);
      expect(events, set).toHaveLength(GOLDEN_SPECS[set].target);
      expect(footer.events).toBe(meta.events);
      expect(report.devices, set).toEqual(meta.devices);
      expect(header.devices, set).toEqual(meta.devices);
      expect(header.root_hash, set).toBe(meta.root_hash);
      expect(rootHash(NODE_HASH_PORT, meta.devices), set).toBe(meta.root_hash);
      // 헤더 앵커 대조(앵커 ②) — 모든 기기의 앵커 seq 해시가 일치
      const hashAt = (device: string, seq: number): string | null =>
        events.find((e) => e.device_id === device && e.device_seq === seq)?.hash ?? null;
      expect(verifyAnchor(header.devices, hashAt), set).toEqual([]);
      expect(meta.seed).toBe(GOLDEN_SPECS[set].seed);
      expect(meta.set).toBe(set);
      // 타입별 건수가 meta와 같다
      const counts: Record<string, number> = {};
      for (const e of events) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
      }
      expect(counts, set).toEqual(meta.types);
    }
  });

  it('UT-LR-611 17종 커버: basic은 17종 전부 ≥ 1, 합집합도 17종 [NFR-DATA-003]', () => {
    const basic = readGoldenMeta('basic');
    expect(Object.keys(basic.types)).toHaveLength(17);
    const union = new Set<string>();
    for (const set of GOLDEN_SETS) {
      for (const t of Object.keys(readGoldenMeta(set).types)) {
        union.add(t);
      }
    }
    expect(union.size).toBe(17);
    expect(basic.events).toBeGreaterThanOrEqual(1400);
    expect(Object.keys(basic.devices)).toHaveLength(1);
    // 카드는 첫 attempt.graded 전에 card.enrolled
    const { events } = readGoldenLedger('basic');
    const enrolled = new Set<string>();
    for (const e of [...events].sort(compareTotalOrder)) {
      if (e.type === 'card.enrolled') {
        enrolled.add(String(e.payload.card_id));
      } else if (e.type === 'attempt.graded') {
        expect(enrolled.has(String(e.payload.card_id)), String(e.payload.card_id)).toBe(true);
      }
    }
  });

  it('UT-LR-612 two-device: 기기 2·서로 다른 기기의 같은 client_ts ≥ 50쌍·B 체인이 A에 병합 [FR-PRG-003][NFR-DATA-011]', () => {
    const { events } = readGoldenLedger('two-device');
    const meta = readGoldenMeta('two-device');
    expect(Object.keys(meta.devices)).toHaveLength(2);
    const byTs = new Map<number, Set<string>>();
    for (const e of events) {
      const set = byTs.get(e.client_ts) ?? new Set<string>();
      set.add(e.device_id);
      byTs.set(e.client_ts, set);
    }
    const pairs = [...byTs.values()].filter((s) => s.size >= 2).length;
    expect(pairs).toBeGreaterThanOrEqual(50);
    const perDevice = Object.values(meta.devices).map((d) => d.seq);
    expect(perDevice.every((n) => n > 100)).toBe(true);
    expect(perDevice.reduce((a, b) => a + b, 0)).toBe(meta.events);
  });

  it('UT-LR-613 corrections: voided ≥ 30·weight_adjusted ≥ 30·regraded·upgraded ≥ 20, 정정 비율 ≥ 20%, 대상은 앞선 attempt.graded [FR-PRG-002][NFR-DATA-003]', () => {
    const { events } = readGoldenLedger('corrections');
    const meta = readGoldenMeta('corrections');
    expect(meta.types['evidence.voided']).toBeGreaterThanOrEqual(30);
    expect(meta.types['evidence.weight_adjusted']).toBeGreaterThanOrEqual(30);
    expect(meta.types['evidence.regraded']).toBeGreaterThanOrEqual(20);
    expect(meta.types['evidence.upgraded']).toBeGreaterThanOrEqual(20);
    const correctionCount = [
      'evidence.voided',
      'evidence.weight_adjusted',
      'evidence.regraded',
      'evidence.upgraded',
    ].reduce((n, t) => n + (meta.types[t] ?? 0), 0);
    expect(correctionCount / meta.events).toBeGreaterThanOrEqual(0.2);
    const byId = new Map(events.map((e) => [e.event_id, e]));
    for (const e of events) {
      const targets =
        e.type === 'evidence.voided' || e.type === 'evidence.weight_adjusted'
          ? (e.payload.target_event_ids as string[])
          : e.type === 'evidence.regraded' || e.type === 'evidence.upgraded'
            ? [String(e.payload.supersedes_event_id)]
            : [];
      for (const id of targets) {
        const target = byId.get(id);
        expect(target?.type, `${e.type} → ${id}`).toBe('attempt.graded');
        if (target !== undefined) {
          expect(compareTotalOrder(target, e)).toBeLessThan(0); // 앞선 이벤트
        }
      }
    }
  });

  it(
    'UT-LR-614 생성기: 같은 시드 2회 바이트 동일, 커밋본과도 동일 [NFR-DATA-003]',
    async () => {
      for (const set of GOLDEN_SETS) {
        const a = await generateGoldenSet(set);
        const b = await generateGoldenSet(set);
        expect(a.ledger, set).toBe(b.ledger);
        expect(a.metaText, set).toBe(b.metaText);
        expect(a.ledger, `${set} vs committed`).toBe(readFileSync(goldenLedgerPath(set), 'utf8'));
        expect(a.metaText, `${set} meta vs committed`).toBe(readFileSync(goldenMetaPath(set), 'utf8'));
      }
    },
    SLOW,
  );

  it(
    'UT-LR-615 --update-golden 없이 실행하면 커밋본을 건드리지 않고 exit 0(동일) [NFR-DATA-003]',
    () => {
      const before = GOLDEN_SETS.map(
        (s) => sha(readFileSync(goldenLedgerPath(s))) + sha(readFileSync(goldenMetaPath(s))),
      );
      const run = spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source', GENERATOR],
        { cwd: SERVICE_DIR, encoding: 'utf8', timeout: 100_000 },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('golden basic: identical');
      expect(run.stdout).toContain('golden two-device: identical');
      expect(run.stdout).toContain('golden corrections: identical');
      const after = GOLDEN_SETS.map(
        (s) => sha(readFileSync(goldenLedgerPath(s))) + sha(readFileSync(goldenMetaPath(s))),
      );
      expect(after).toEqual(before);
    },
    SLOW,
  );

  it('UT-LR-616 meta.ledger_sha256 = ledger.jsonl 바이트 sha256, footer lines_sha256 정합 [NFR-DATA-003]', () => {
    for (const set of GOLDEN_SETS) {
      const bytes = readFileSync(goldenLedgerPath(set));
      expect(readGoldenMeta(set).ledger_sha256, set).toBe(sha(bytes));
      // 서비스 파서(parseLedgerJsonl)도 같은 파일을 받아들인다 — footer·lines_sha256 검증 포함
      const parsed = parseLedgerJsonl(bytes.toString('utf8'));
      expect(parsed.events, set).toHaveLength(readGoldenMeta(set).events);
      expect(readGoldenLedger(set).footer, set).toEqual(parsed.footer);
    }
  });

  it('UT-LR-617 총순서 재생 시 카드별 fsrs_at 비감소(기기 안에서는 엄격 증가) [FR-PRG-003][FR-PRG-027]', () => {
    for (const set of GOLDEN_SETS) {
      const { events } = readGoldenLedger(set);
      const last = new Map<string, number>();
      for (const e of [...events].sort(compareTotalOrder)) {
        if (e.type !== 'attempt.graded') {
          continue;
        }
        const card = String(e.payload.card_id);
        const at = Number(e.payload.fsrs_at);
        expect(at, `${set} ${card}`).toBeGreaterThan(last.get(card) ?? -1); // 총순서에서 엄격 증가(카드는 한 기기가 소유)
        last.set(card, at);
      }
      expect(last.size, set).toBeGreaterThanOrEqual(12);
    }
  });

  it('UT-LR-618 생성기는 실제 writer 경로만 쓴다(직접 SQL INSERT 0, createLedgerWriter·importInTx 사용) [NFR-DATA-001][FR-PRG-003]', () => {
    const source = readFileSync(GENERATOR, 'utf8');
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\bINSERT\b/i);
    expect(code).not.toMatch(/\bprepare\(\s*['"`]/);
    expect(code).toContain('createLedgerWriter(');
    expect(code).toContain('writer.append(');
    expect(code).toContain('importInTx(');
    // 해시는 writer가 만든 것 — 체인 검증(610)이 통과하는 것이 같은 증거다.
  });

  it('UT-LR-619 03:30~04:30 KST 경계 사례·rating 1~4·pending(rating null) 포함, study_day는 생성 시 04:00 경계 규칙 그대로 [FR-PRG-027][FR-PRG-009]', () => {
    for (const set of GOLDEN_SETS) {
      const { events } = readGoldenLedger(set);
      const ratings = new Set<number | null>();
      let before = 0;
      let after = 0;
      for (const e of events.filter((x) => x.type === 'attempt.graded')) {
        ratings.add(e.payload.rating as number | null);
        const answered = Number(e.payload.issued_at);
        // KST 로컬 시각 분(UTC+9, DST 없음) — 생성기와 독립적인 산술
        const minuteOfDay = (((Math.floor(answered / 60_000) + 9 * 60) % 1440) + 1440) % 1440;
        if (minuteOfDay >= 210 && minuteOfDay < 240) {
          before += 1;
        } else if (minuteOfDay >= 240 && minuteOfDay <= 270) {
          after += 1;
        }
        expect(e.payload.study_day, `${set} ${e.event_id}`).toBe(studyDayOf(answered, GOLDEN_STUDY_DAY));
      }
      expect(before, `${set} 03:30~03:59`).toBeGreaterThanOrEqual(set === 'corrections' ? 3 : 8);
      expect(after, `${set} 04:00~04:30`).toBeGreaterThanOrEqual(set === 'corrections' ? 3 : 8);
      expect([...ratings].sort(), set).toEqual([1, 2, 3, 4, null]);
    }
    // 경계 앞뒤 사례가 서로 다른 study_day로 갈린다(03:5x = 전날).
    const { events } = readGoldenLedger('basic');
    const samples = events
      .filter((e) => e.type === 'attempt.graded')
      .map((e) => [Number(e.payload.issued_at), String(e.payload.study_day)] as const);
    const near = samples.filter(([t]) => {
      const m = (((Math.floor(t / 60_000) + 540) % 1440) + 1440) % 1440;
      return m >= 235 && m < 245;
    });
    expect(new Set(near.map(([, d]) => d)).size).toBeGreaterThanOrEqual(2);
  });
});
