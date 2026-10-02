import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { applyIncremental } from '../../../../src/application/learner-model/incremental.js';
import type {
  EventTargetLookup,
  LedgerReplaySource,
  ProjectionStore,
  ProjectorParamsResolver,
} from '../../../../src/application/learner-model/ports.js';
import { foldEvents } from '../../../../src/domain/learner-model/projector/apply.js';
import { buildCorrectionIndex } from '../../../../src/domain/learner-model/projector/corrections.js';
import { ProjectionParamsError } from '../../../../src/domain/learner-model/projector/errors.js';
import type {
  CardRow,
  ConceptRow,
  ProjectionSlice,
  ProjectorParams,
} from '../../../../src/domain/learner-model/projector/types.js';

// 메모리 원장·저장소·파라미터 해석기 — 증분 적용(applyIncremental)과 전체 리플레이를 DB 없이 비교하는 테스트용 구현.
// 총순서 비교는 도메인 compareOrder를 쓰지 않고 독립 구현(client_ts → device_id → device_seq)한다.

export const FAKE_DB: SqlitePort = {
  path: ':memory:',
  readOnly: false,
  prepare() {
    throw new Error('FAKE_DB.prepare must not be called');
  },
  exec() {
    throw new Error('FAKE_DB.exec must not be called');
  },
  tx<T>(fn: () => T): T {
    return fn();
  },
  fn() {
    // no-op
  },
  close() {
    // no-op
  },
};

export function totalOrder(a: LedgerEventEnvelope, b: LedgerEventEnvelope): number {
  if (a.client_ts !== b.client_ts) {
    return a.client_ts - b.client_ts;
  }
  if (a.device_id !== b.device_id) {
    return a.device_id < b.device_id ? -1 : 1;
  }
  return a.device_seq - b.device_seq;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' ? v : null;
}

export class MemoryLedger implements LedgerReplaySource, EventTargetLookup {
  readonly rows: LedgerEventEnvelope[] = [];

  append(e: LedgerEventEnvelope): void {
    this.rows.push(e);
  }

  private sorted(pred: (e: LedgerEventEnvelope) => boolean = () => true): IterableIterator<LedgerEventEnvelope> {
    return this.rows.filter(pred).sort(totalOrder)[Symbol.iterator]();
  }

  replay(_db: SqlitePort): IterableIterator<LedgerEventEnvelope> {
    return this.sorted();
  }
  byCard(_db: SqlitePort, cardId: string): IterableIterator<LedgerEventEnvelope> {
    return this.sorted((e) => str(e.payload, 'card_id') === cardId);
  }
  byConcept(_db: SqlitePort, conceptId: string): IterableIterator<LedgerEventEnvelope> {
    return this.sorted((e) => str(e.payload, 'concept_id') === conceptId);
  }
  corrections(_db: SqlitePort): IterableIterator<LedgerEventEnvelope> {
    return this.sorted((e) => e.type === 'evidence.voided' || e.type === 'evidence.weight_adjusted');
  }
  maxRowid(_db: SqlitePort): number {
    return this.rows.length;
  }
  sinceRowid(_db: SqlitePort, after: number): IterableIterator<LedgerEventEnvelope> {
    return this.rows.slice(after)[Symbol.iterator]();
  }
  keysOf(
    _db: SqlitePort,
    eventIds: readonly string[],
  ): { readonly card_ids: readonly string[]; readonly concept_ids: readonly string[] } {
    const ids = new Set(eventIds);
    const cards = new Set<string>();
    const concepts = new Set<string>();
    for (const e of this.rows) {
      if (!ids.has(e.event_id)) {
        continue;
      }
      const c = str(e.payload, 'card_id');
      const k = str(e.payload, 'concept_id');
      if (c !== null) {
        cards.add(c);
      }
      if (k !== null) {
        concepts.add(k);
      }
    }
    return { card_ids: [...cards].sort(), concept_ids: [...concepts].sort() };
  }
}

export class MemoryStore implements ProjectionStore {
  readonly cards = new Map<string, CardRow>();
  readonly concepts = new Map<string, ConceptRow>();
  puts = 0;

  getCard(cardId: string): CardRow | null {
    return this.cards.get(cardId) ?? null;
  }
  putCard(row: CardRow): void {
    this.puts += 1;
    this.cards.set(row.card_id, row);
  }
  getConcept(conceptId: string): ConceptRow | null {
    return this.concepts.get(conceptId) ?? null;
  }
  putConcept(row: ConceptRow): void {
    this.puts += 1;
    this.concepts.set(row.concept_id, row);
  }
  toSlice(): ProjectionSlice {
    return { cards: Object.fromEntries(this.cards), concepts: Object.fromEntries(this.concepts) };
  }
}

export class MemoryResolver implements ProjectorParamsResolver {
  readonly registered: { policyVersion: string; members: unknown }[] = [];
  private readonly sets = new Map<string, ProjectorParams>();

  constructor(params: readonly ProjectorParams[]) {
    for (const p of params) {
      this.sets.set(p.policy_version, p);
    }
  }

  resolve(_db: SqlitePort, policyVersion: string): ProjectorParams {
    const hit = this.sets.get(policyVersion);
    if (hit === undefined) {
      throw new ProjectionParamsError('params_unresolvable', policyVersion, 'unknown policy set (test resolver)');
    }
    return hit;
  }
  register(policyVersion: string, members: Readonly<Record<string, { version: string; sha256: string }>>): void {
    this.registered.push({ policyVersion, members });
  }
}

/** 슬라이스의 정준 JSON sha256 — 같은 투영이면 같은 값(바이트 비교 대용). */
export function sliceHash(slice: ProjectionSlice): string {
  return sha256Hex(canonicalJson({ cards: slice.cards, concepts: slice.concepts }));
}

/** 이벤트를 도착 순서대로 원장에 넣고 증분 적용한다. 결과 = 저장소 slice. */
export function runIncremental(
  events: readonly LedgerEventEnvelope[],
  resolver: ProjectorParamsResolver,
): { readonly slice: ProjectionSlice; readonly ledger: MemoryLedger; readonly store: MemoryStore } {
  const ledger = new MemoryLedger();
  const store = new MemoryStore();
  for (const e of events) {
    ledger.append(e);
    applyIncremental({ db: FAKE_DB, source: ledger, targets: ledger, store, params: resolver }, e);
  }
  return { slice: store.toSlice(), ledger, store };
}

/** 전체 리플레이(2-패스, 총순서). */
export function runReplay(events: readonly LedgerEventEnvelope[], resolver: ProjectorParamsResolver): ProjectionSlice {
  const ledger = new MemoryLedger();
  for (const e of events) {
    ledger.append(e);
  }
  const index = buildCorrectionIndex(ledger.replay(FAKE_DB));
  return foldEvents(ledger.replay(FAKE_DB), (ps) => resolver.resolve(FAKE_DB, ps), index);
}
