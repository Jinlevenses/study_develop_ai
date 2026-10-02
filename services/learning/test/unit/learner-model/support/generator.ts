import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { createPrng, type Prng } from '@fathom/testkit/prng';
import { cardIdOf, DAY, DEV_A, DEV_B, EventFactory, T0 } from './events.js';
import { REPO_PS } from './policy.js';

// 속성 테스트용 무작위 원장 생성기. 시드 고정(STD-TST-03). 반환 = 생성 시각순(= 도착 순서로 쓸 수 있고, 정정은 항상 앞선 이벤트만 가리킨다).
// 두 기기는 시계 오프셋이 달라 client_ts가 교차·동률·역전(지각 도착)한다.

export type GenOptions = {
  readonly min?: number;
  readonly max?: number;
  /** 사용할 정책 세트(주소). 둘 이상이면 중간에 전환한다. */
  readonly policySets?: readonly string[];
  /** false면 정정(void·weight·upgraded·regraded)을 만들지 않는다. */
  readonly corrections?: boolean;
  /** true면 void·weight_adjust가 가끔 사슬 구성원(upgraded/regraded)을 직접 가리킨다(root 정규화 검증). 기본 false = 골든 입력 보존. */
  readonly chainTargets?: boolean;
};

const CONCEPTS = ['k8s.probes', 'k8s.pods', 'net.tcp'] as const;
const FACETS = ['concept', 'code'] as const;
const FORMATS = ['ox', 'mcq', 'short', 'cloze', 'code_task', 'fermi'] as const;
const RESULTS = ['correct', 'correct', 'partial', 'incorrect', 'incorrect', 'pending'] as const;
const W_FORMAT = [1, 1, 0.8, 0.7, 0.5] as const;
const W_GRADER = [1, 1, 0.9, 0.7, 0.6, 0.3] as const;
const GAMING = [1, 1, 1, 0.8, 0.64] as const;
const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23'] as const;

type Meta = {
  readonly concept: string;
  readonly facet: 'concept' | 'code';
  readonly mode: 'recognition' | 'production';
};

function verdictPick(rng: Prng): {
  result: (typeof RESULTS)[number];
  format: (typeof FORMATS)[number];
  item_n_options: number;
  w_format: number;
  w_grader: number;
  gaming_factor: number;
  rapid: boolean;
  item_beta: number;
} {
  const format = rng.pick(FORMATS);
  const betaStep = rng.int(-10, 10);
  return {
    result: rng.pick(RESULTS),
    format,
    item_n_options: format === 'ox' ? 2 : format === 'mcq' ? 4 : 0,
    w_format: rng.pick(W_FORMAT),
    w_grader: rng.pick(W_GRADER),
    gaming_factor: rng.pick(GAMING),
    rapid: rng.next() < 0.1,
    item_beta: betaStep / 10,
  };
}

export function generateLedger(seed: number, o: GenOptions = {}): LedgerEventEnvelope[] {
  const rng = createPrng(seed);
  const total = rng.int(o.min ?? 40, o.max ?? 120);
  const sets = o.policySets ?? [REPO_PS];
  const withCorrections = o.corrections !== false;
  const f = new EventFactory(1_000);
  const out: LedgerEventEnvelope[] = [];
  const offset: Record<string, number> = { [DEV_A]: 0, [DEV_B]: rng.int(-400_000, 400_000) };
  const lastTs = new Map<string, number>();
  const cards = new Map<string, Meta>();
  const graded: { id: string; meta: Meta }[] = [];
  const superseding: { id: string; meta: Meta }[] = [];
  let now = T0;
  let setIdx = 0;

  const nextTs = (device: string): number => {
    const prev = lastTs.get(device) ?? 0;
    let ts = Math.max(now + (offset[device] ?? 0), prev + 1);
    if (rng.next() < 0.08) {
      // 다른 기기 직전 이벤트와 같은 client_ts(동률 → device_id 순)
      const other = out.at(-1);
      if (other !== undefined && other.device_id !== device && other.client_ts > prev) {
        ts = other.client_ts;
      }
    }
    lastTs.set(device, ts);
    return ts;
  };
  const ps = (): string => sets[setIdx] ?? REPO_PS;
  const enroll = (device: string): void => {
    const concept = rng.pick(CONCEPTS);
    const facet = rng.pick(FACETS);
    const mode = rng.next() < 0.3 ? 'recognition' : 'production';
    const id = cardIdOf(concept, facet, mode);
    if (cards.has(id)) {
      return;
    }
    cards.set(id, { concept, facet, mode });
    out.push(
      f.enrolled(
        { ts: nextTs(device), device },
        {
          concept_id: concept,
          facet,
          response_mode: mode,
          tier: rng.pick(['A', 'B', 'C'] as const),
          policy_version: ps(),
        },
      ),
    );
  };

  for (let i = 0; i < 4; i += 1) {
    now += rng.int(1_000, 60_000);
    enroll(rng.next() < 0.5 ? DEV_A : DEV_B);
  }
  while (out.length < total) {
    now += rng.int(1_000, 4 * 3_600_000);
    const device = rng.next() < 0.5 ? DEV_A : DEV_B;
    const roll = rng.next();
    if (roll < 0.04 && sets.length > 1) {
      setIdx = (setIdx + 1) % sets.length;
      out.push(
        f.policySwitched(
          { ts: nextTs(device), device },
          { policy_version: ps(), previous: sets[(setIdx + sets.length - 1) % sets.length] },
        ),
      );
    } else if (roll < 0.1) {
      enroll(device);
    } else if (roll < 0.17) {
      const id = rng.pick([...cards.keys()]);
      out.push(
        f.statusChanged(
          { ts: nextTs(device), device },
          id,
          rng.pick(['active', 'active', 'suspended', 'retired'] as const),
          { policy_version: ps() },
        ),
      );
    } else if (roll < 0.28 && withCorrections && graded.length > 0) {
      // void·weight_adjust는 가끔 사슬 구성원(upgraded/regraded)을 직접 가리킨다 — root 정규화 경로(ADR-011 §5) 검증
      const target =
        o.chainTargets === true && superseding.length > 0 && rng.next() < 0.25
          ? rng.pick(superseding)
          : rng.pick(graded);
      const kind = rng.int(0, 4);
      const meta = { ts: nextTs(device), device };
      if (kind === 0) {
        out.push(f.voided(meta, [target.id], { policy_version: ps() }));
      } else if (kind === 1) {
        out.push(
          f.weightAdjusted(
            meta,
            [target.id],
            { kind: 'factor', factor: rng.pick([0, 0.25, 0.5, 1] as const) },
            { policy_version: ps() },
          ),
        );
      } else if (kind === 2) {
        out.push(
          f.weightAdjusted(
            meta,
            [target.id],
            {
              kind: 'set',
              w_format: rng.next() < 0.5 ? null : rng.pick(W_FORMAT),
              w_grader: rng.next() < 0.5 ? null : rng.pick(W_GRADER),
              gaming_factor: rng.next() < 0.5 ? null : rng.pick(GAMING),
            },
            { policy_version: ps() },
          ),
        );
      } else {
        const chain = superseding.length > 0 && rng.next() < 0.3 ? rng.pick(superseding) : target;
        const v = verdictPick(rng);
        const opts = {
          ...v,
          concept_id: chain.meta.concept,
          facet: chain.meta.facet,
          response_mode: chain.meta.mode,
          policy_version: ps(),
          study_day: rng.pick(DAYS),
        };
        const e = kind === 3 ? f.upgraded(meta, chain.id, opts) : f.regraded(meta, chain.id, opts);
        out.push(e);
        superseding.push({ id: e.event_id, meta: chain.meta });
      }
    } else if (cards.size > 0) {
      const id = rng.pick([...cards.keys()]);
      const meta = cards.get(id);
      if (meta === undefined) {
        continue;
      }
      const v = verdictPick(rng);
      const ts = nextTs(device);
      const e = f.graded(
        { ts, device },
        {
          ...v,
          concept_id: meta.concept,
          facet: meta.facet,
          response_mode: meta.mode,
          card_id: id,
          rating: v.result === 'pending' ? null : rng.pick([1, 2, 3, 3, 4] as const),
          fsrs_at: rng.next() < 0.15 ? ts - rng.int(0, 5_000) : ts,
          study_day: rng.pick(DAYS),
          policy_version: ps(),
        },
      );
      out.push(e);
      graded.push({ id: e.event_id, meta });
    }
  }
  return out;
}

/** ms → 'YYYY-MM-DD'(UTC) — study_day 값 생성용(테스트 전용, 도메인 규칙 아님). */
export function dayOf(ms: number): string {
  return new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
}
