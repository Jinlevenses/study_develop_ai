import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Verdict } from '@fathom/contracts/events/catalog/grading';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { infraMigrationsDir } from '@fathom/shared-kernel/service/infra-dir';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock, type FakeClock } from '@fathom/testkit/clock';
import { createUlidSequence } from '@fathom/testkit/ids';
import { createPrng, type Prng } from '@fathom/testkit/prng';
import { createTempHome } from '@fathom/testkit/temp-home';
import { createCheckpoint } from '../../../src/application/ledger/checkpoint.js';
import { verdictToAttemptDraft } from '../../../src/application/ledger/inbox/grading-verdict-issued.js';
import { readExportEvents, serializeLedgerJsonl } from '../../../src/application/ledger/jsonl.js';
import type { LedgerAppendDraft, LedgerWriter } from '../../../src/application/ledger/ports.js';
import { NOOP_PROJECTION_APPLIER } from '../../../src/application/ledger/ports.js';
import { clampAnsweredAt, nextFsrsAt, studyDayOf } from '../../../src/domain/ledger/time/study-day.js';
import { LEARNING_DB } from '../../../src/infra/db/open.js';
import { LR_DEVICE_LOCAL } from '../../../src/infra/ledger/ledger.sql.js';
import { createLedgerWriter } from '../../../src/infra/ledger/ledger-writer.js';
import { createLedgerReplayReader } from '../../../src/infra/ledger/replay-source.js';
import {
  buildVerdict,
  cardEnrolledPayload,
  carriedFields,
  GOLDEN_CONCEPTS,
  GOLDEN_POLICY,
  GOLDEN_STUDY_DAY,
  itemIdOf,
  sha,
  trackOf,
  type VerdictResult,
  type VerdictSpec,
} from './payloads.js';

// CR-65 골든 원장 생성기(결정적). 시드 + createFakeClock + createUlidSequence + createPrng + **실제** createLedgerWriter(NOOP 투영)만으로 만든다 — 직접 SQL INSERT 0.
// 실행: node --disable-warning=ExperimentalWarning --import tsx --conditions=source services/learning/test/golden/ledger/generate-golden.ts [--update-golden]

export const GOLDEN_SET_NAMES = ['basic', 'two-device', 'corrections'] as const;
export type GoldenSetName = (typeof GOLDEN_SET_NAMES)[number];

type Kind =
  | 'attempt'
  | 'pretest'
  | 'lesson'
  | 'self'
  | 'status'
  | 'setting'
  | 'aimode'
  | 'declaration'
  | 'exam'
  | 'promote'
  | 'resolve'
  | 'upgrade'
  | 'regrade'
  | 'void'
  | 'weight';

type SetSpec = {
  readonly seed: number;
  readonly target: number;
  readonly mix: Readonly<Partial<Record<Kind, number>>>;
};
export const GOLDEN_SPECS: Readonly<Record<GoldenSetName, SetSpec>> = {
  basic: {
    seed: 101,
    target: 1500,
    mix: {
      pretest: 45,
      lesson: 60,
      self: 70,
      status: 14,
      setting: 12,
      aimode: 6,
      declaration: 6,
      exam: 6,
      promote: 6,
      resolve: 3,
      upgrade: 12,
      regrade: 12,
      void: 8,
      weight: 8,
    },
  },
  'two-device': {
    seed: 202,
    target: 1200,
    mix: {
      pretest: 35,
      lesson: 45,
      self: 55,
      status: 10,
      setting: 8,
      aimode: 4,
      declaration: 4,
      exam: 4,
      promote: 4,
      resolve: 2,
      upgrade: 6,
      regrade: 6,
      void: 4,
      weight: 4,
    },
  },
  corrections: {
    seed: 303,
    target: 600,
    mix: {
      pretest: 12,
      lesson: 12,
      self: 15,
      status: 5,
      setting: 4,
      aimode: 2,
      declaration: 2,
      exam: 2,
      promote: 2,
      resolve: 1,
      upgrade: 30,
      regrade: 30,
      void: 45,
      weight: 45,
    },
  },
};

export const GOLDEN_DIR = fileURLToPath(
  new URL('../../../../../packages/testkit/src/golden-ledgers/', import.meta.url),
);
const GENERATED_BY = 'services/learning/test/golden/ledger/generate-golden.ts';
const KST_MIDNIGHT_DAY0 = 1_790_002_800_000; // 2026-09-22T00:00:00+09:00
const DAY_MS = 86_400_000;
const CARD_COUNT = 12;

export type GoldenMeta = {
  readonly format: 'fathom.golden-ledger.v1';
  readonly set: GoldenSetName;
  readonly seed: number;
  readonly events: number;
  readonly devices: Record<string, { seq: number; head_hash: string }>;
  readonly root_hash: string;
  readonly types: Record<string, number>;
  readonly ledger_sha256: string;
  readonly generated_by: string;
};
export type GeneratedGolden = { readonly ledger: string; readonly meta: GoldenMeta; readonly metaText: string };

// ───────── DB·행위자 ─────────

async function openGoldenDb(dbPath: string): Promise<SqlitePort> {
  const rt = await loadSqliteRuntime();
  const db = rt.openDb(dbPath, {
    synchronous: LEARNING_DB.synchronous,
    recursiveTriggers: LEARNING_DB.recursiveTriggers,
  });
  const res = rt.migrate(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...LEARNING_DB.migrations], {
    dryRun: false,
    profile: LEARNING_DB.profile,
    applicationId: LEARNING_DB.applicationId,
    clock: createFakeClock(),
  });
  if (!res.ok) {
    throw new Error(`golden: migrate failed: ${res.error.reason}`);
  }
  return db;
}

type Actor = {
  readonly index: number;
  readonly db: SqlitePort;
  readonly clock: FakeClock;
  readonly newId: () => string;
  readonly writer: LedgerWriter;
};

function makeActor(index: number, db: SqlitePort, idStart: number): Actor {
  const clock = createFakeClock();
  const newId = createUlidSequence(idStart);
  const writer = createLedgerWriter({
    db,
    clock,
    newId,
    applier: NOOP_PROJECTION_APPLIER,
    alarm: {
      raise(kind, detail): void {
        throw new Error(`golden: integrity alarm ${kind}: ${detail.message}`);
      },
    },
    policySet: () => GOLDEN_POLICY,
    studyDay: GOLDEN_STUDY_DAY,
    platform: `golden-${index}`,
  });
  return { index, db, clock, newId, writer };
}

// ───────── 월드 상태 ─────────

type CardInfo = {
  readonly card_id: string;
  readonly concept: string;
  readonly facet: string;
  readonly mode: 'recognition' | 'production';
  readonly tier: 'A' | 'B' | 'C';
  readonly owner: number;
  last_fsrs_at: number | null;
  status: 'active' | 'suspended';
};
type GradedInfo = {
  readonly event_id: string;
  readonly spec: VerdictSpec;
  readonly card_id: string;
  readonly visible: Set<number>;
  superseded: boolean;
  corrected: boolean;
};
type PromotedInfo = { readonly track: string; readonly level: number; resolved: boolean };

const FACETS: readonly (readonly [string, 'recognition' | 'production', 'A' | 'B' | 'C'])[] = [
  ['definition', 'recognition', 'A'],
  ['definition', 'production', 'A'],
  ['mechanism', 'production', 'B'],
  ['code', 'production', 'C'],
];
const RECOGNITION_FORMATS = ['ox', 'mcq', 'mcq_multi', 'matching'] as const;
const PRODUCTION_FORMATS = ['short', 'cloze', 'essay'] as const;
const SESSION_SLOTS: readonly (readonly [number, number])[] = [
  [7, 30],
  [12, 10],
  [19, 45],
  [21, 40],
  [23, 20],
  [0, 40],
];
const BOUNDARY_SLOTS: readonly (readonly [number, number])[] = [
  [3, 30],
  [3, 48],
  [3, 52],
  [3, 57],
  [4, 0],
  [4, 2],
  [4, 10],
];

function kstEpoch(dayOffset: number, hour: number, minute: number): number {
  return KST_MIDNIGHT_DAY0 + dayOffset * DAY_MS + (hour * 60 + minute) * 60_000;
}

class Timeline {
  sessionStartedAt = 0;
  private readonly prng: Prng;
  private now = 0;
  private left = 0;
  private day = 0;
  constructor(prng: Prng) {
    this.prng = prng;
  }
  next(): number {
    if (this.left <= 0) {
      this.left = this.prng.int(6, 30);
      const slots = this.prng.next() < 0.3 ? BOUNDARY_SLOTS : SESSION_SLOTS;
      const [h, m] = this.prng.pick(slots);
      this.day += this.prng.pick([1, 1, 1, 2, 3]);
      const wanted = kstEpoch(this.day, h, m);
      this.now = wanted <= this.now + 600_000 ? this.now + 6 * 3_600_000 : wanted;
      this.sessionStartedAt = this.now;
    } else {
      this.now += this.prng.int(15, 120) * 1000;
    }
    this.left -= 1;
    return this.now;
  }
}

// ───────── 생성 ─────────

class Generator {
  readonly cards: CardInfo[] = [];
  readonly graded: GradedInfo[] = [];
  readonly promoted: PromotedInfo[] = [];
  private readonly nextLevel = new Map<string, number>();
  private readonly resolveCount = new Map<string, number>();
  /** two-device: 1단계(A 단독) 이후에는 새 채점 이벤트가 만든 기기에게만 보인다. */
  afterSplit = false;
  private readonly prng: Prng;
  private readonly timeline: Timeline;
  private readonly twoDevice: boolean;
  private suspended = 0;

  constructor(prng: Prng, timeline: Timeline, twoDevice: boolean) {
    this.prng = prng;
    this.timeline = timeline;
    this.twoDevice = twoDevice;
    let n = 0;
    for (const concept of GOLDEN_CONCEPTS) {
      for (const [facet, mode, tier] of FACETS) {
        this.cards.push({
          card_id: `${concept}:${facet}:${mode === 'recognition' ? 'r' : 'p'}`,
          concept,
          facet,
          mode,
          tier,
          owner: twoDevice ? n % 2 : 0,
          last_fsrs_at: null,
          status: 'active',
        });
        n += 1;
      }
    }
  }

  private studyDay(at: number): string {
    return studyDayOf(at, GOLDEN_STUDY_DAY);
  }
  private base(actor: Actor): { now: number; study_day: string; policy_version: string } {
    const now = actor.clock.now();
    return { now, study_day: this.studyDay(now), policy_version: GOLDEN_POLICY.policy_version };
  }

  enrollDraft(card: CardInfo, actor: Actor): LedgerAppendDraft {
    const b = this.base(actor);
    return {
      type: 'card.enrolled',
      idempotency_key: `card:${card.card_id}`,
      payload: cardEnrolledPayload({
        card_id: card.card_id,
        concept_id: card.concept,
        facet: card.facet,
        response_mode: card.mode,
        tier: card.tier,
        study_day: b.study_day,
      }),
    };
  }

  private ownedActive(actor: Actor): CardInfo[] {
    return this.cards.filter((c) => c.status === 'active' && (!this.twoDevice || c.owner === actor.index));
  }
  private visibleGraded(actor: Actor, pred: (g: GradedInfo) => boolean): GradedInfo[] {
    return this.graded.filter((g) => g.visible.has(actor.index) && pred(g));
  }
  private verdictSpec(
    actor: Actor,
    c: { concept: string; facet: string; mode: 'recognition' | 'production'; tier: 'A' | 'B' | 'C' },
    result: VerdictResult,
    issuedAt: number,
  ): VerdictSpec {
    const p = this.prng;
    return {
      verdict_id: actor.newId(),
      attempt_id: actor.newId(),
      session_id: actor.newId(),
      block_id: p.next() < 0.7 ? actor.newId() : null,
      item_n: p.int(1, 8),
      concept_id: c.concept,
      facet: c.facet,
      response_mode: c.mode,
      result,
      format:
        c.mode === 'recognition'
          ? p.pick(RECOGNITION_FORMATS)
          : c.facet === 'code'
            ? 'code_task'
            : p.pick(PRODUCTION_FORMATS),
      tier: c.tier,
      item_beta: Math.round((p.next() * 3 - 1.5) * 1000) / 1000,
      confidence: p.pick([1, 2, 3, null] as const),
      latency_ms: p.int(1200, 45_000),
      hints_used: p.pick([0, 0, 0, 1, 2]),
      ai_mode: p.next() < 0.15 ? 'FULL' : 'OFFLINE',
      issued_at: issuedAt,
    };
  }
  private pickResult(): VerdictResult {
    const r = this.prng.next();
    return r < 0.09 ? 'pending' : r < 0.55 ? 'correct' : r < 0.75 ? 'partial' : 'incorrect';
  }

  /** null = 이 시점에 만들 수 없음(선행 이벤트 없음) → 호출자가 뒤로 미룬다. */
  build(kind: Kind, actor: Actor): { draft: LedgerAppendDraft; after?: (event: LedgerEventEnvelope) => void } | null {
    const p = this.prng;
    const b = this.base(actor);
    switch (kind) {
      case 'attempt': {
        const card = p.pick(this.ownedActive(actor));
        const result = this.pickResult();
        const answeredAt = b.now - p.int(1, 20) * 1000;
        const clamped = clampAnsweredAt(answeredAt, this.timeline.sessionStartedAt, b.now);
        const spec = this.verdictSpec(actor, card, result, clamped);
        const verdict: Verdict = buildVerdict(spec);
        const fsrsAt = nextFsrsAt(clamped, card.last_fsrs_at);
        const draft = verdictToAttemptDraft(verdict, {
          phase: p.pick(['practice', 'practice', 'practice', 'verify', 'embedded']),
          rating: result === 'pending' ? null : (verdict.recommended_grade as 1 | 2 | 3 | 4),
          cbm_score:
            verdict.confidence === null
              ? null
              : result === 'correct'
                ? verdict.confidence
                : result === 'partial'
                  ? 0
                  : -2 * (verdict.confidence - 1),
          fsrs_at: fsrsAt,
          study_day: this.studyDay(clamped),
          policy_version: GOLDEN_POLICY.policy_version,
        });
        return {
          draft,
          after: (event) => {
            card.last_fsrs_at = fsrsAt;
            this.graded.push({
              event_id: event.event_id,
              spec,
              card_id: card.card_id,
              visible: this.twoDevice && this.afterSplit ? new Set([actor.index]) : new Set([0, 1]),
              superseded: false,
              corrected: false,
            });
          },
        };
      }
      case 'pretest': {
        const concept = p.pick(GOLDEN_CONCEPTS);
        const spec = this.verdictSpec(
          actor,
          { concept, facet: 'definition', mode: 'recognition', tier: 'A' },
          this.pickResult(),
          b.now,
        );
        const itemId = itemIdOf(concept, spec.item_n);
        return {
          draft: {
            type: 'pretest.answered',
            idempotency_key: `att:${spec.attempt_id}`,
            payload: {
              attempt_id: spec.attempt_id,
              verdict_id: spec.verdict_id,
              item_id: itemId,
              item_content_hash: sha(`item:${itemId}:v1`),
              concept_id: concept,
              item_beta: spec.item_beta,
              item_n_options: 4,
              result: spec.result,
              latency_ms: spec.latency_ms,
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
        };
      }
      case 'lesson': {
        const stage = p.pick(['theory', 'code', 'core'] as const);
        return {
          draft: {
            type: 'lesson.completed',
            idempotency_key: `cmd:${actor.newId()}:${stage}`,
            payload: {
              concept_id: p.pick(GOLDEN_CONCEPTS),
              session_id: actor.newId(),
              block_id: actor.newId(),
              stage,
              duration_ms: p.int(60_000, 900_000),
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
        };
      }
      case 'self': {
        const k = p.pick(['self_grade', 'jol', 'regrade_rating_confirm', 'bias_probe'] as const);
        const concept = p.pick(GOLDEN_CONCEPTS);
        const value =
          k === 'self_grade'
            ? { kind: 'grade', grade: p.int(0, 4) }
            : k === 'regrade_rating_confirm'
              ? { kind: 'rating_confirm', accepted: p.next() < 0.7, rating: p.pick([1, 2, 3, 4] as const) }
              : { kind: 'probability', p: Math.round(p.next() * 100) / 100 };
        return {
          draft: {
            type: 'self_assessment.recorded',
            idempotency_key: p.next() < 0.5 ? `cmd:${actor.newId()}` : `cmd:${actor.newId()}:${k}`,
            payload: {
              kind: k,
              target: { kind: 'concept', id: concept },
              value,
              session_id: p.next() < 0.5 ? actor.newId() : null,
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
        };
      }
      case 'status': {
        const suspended = this.cards.filter(
          (c) => c.status === 'suspended' && (!this.twoDevice || c.owner === actor.index),
        );
        const resume = suspended.length > 0 && (this.suspended >= 3 || p.next() < 0.5);
        const card = resume ? p.pick(suspended) : p.pick(this.ownedActive(actor));
        if (!resume && this.ownedActive(actor).length <= 3) {
          return null;
        }
        return {
          draft: {
            type: 'card.status_changed',
            idempotency_key: `cmd:${actor.newId()}`,
            payload: {
              card_id: card.card_id,
              status: resume ? 'active' : 'suspended',
              reason: 'user',
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
          after: () => {
            card.status = resume ? 'active' : 'suspended';
            this.suspended += resume ? -1 : 1;
          },
        };
      }
      case 'setting': {
        const [key, from, to] = p.pick([
          ['session.default_minutes', 25, 45],
          ['session.default_minutes', 45, 25],
          ['ui.theme', 'light', 'dark'],
          ['study.day_boundary_minutes', 240, 300],
          ['ai.default_mode', 'OFFLINE', 'JUDGE_ONLY'],
        ] as const);
        return {
          draft: {
            type: 'profile.setting_changed',
            idempotency_key: `cmd:${actor.newId()}:${key}`,
            payload: { key, from, to, study_day: b.study_day },
          },
        };
      }
      case 'aimode': {
        const sourceId = actor.newId();
        return {
          draft: {
            type: 'ai_mode.observed',
            idempotency_key: `aimode:${sourceId}`,
            payload: {
              mode: p.pick(['OFFLINE', 'FULL', 'JUDGE_ONLY', 'LLM_ONLY'] as const),
              providers: [{ id: 'jev', kind: 'jev', status: 'ok' }],
              source_event_id: sourceId,
              observed_at: b.now,
              study_day: b.study_day,
            },
          },
        };
      }
      case 'declaration': {
        return {
          draft: {
            type: 'declaration.sealed',
            idempotency_key: `cmd:${actor.newId()}`,
            payload: {
              declaration_id: actor.newId(),
              kind: p.pick(['time_capsule', 'anchor_0', 'season_goal', 'self_declaration'] as const),
              content_hash: sha(`declaration:${b.now}`),
              sealed_payload: { goal: p.pick(['probe-design', 'event-loop-trace', 'handshake-diagram']) },
              unseal_at: p.next() < 0.5 ? b.now + 30 * DAY_MS : null,
              study_day: b.study_day,
            },
          },
        };
      }
      case 'exam': {
        const concept = p.pick(GOLDEN_CONCEPTS);
        const correct = p.int(5, 12);
        const examId = actor.newId();
        return {
          draft: {
            type: 'promotion.exam_completed',
            idempotency_key: `exam:${examId}`,
            payload: {
              exam_id: examId,
              track: trackOf(concept),
              level: p.int(1, 3),
              item_ids: Array.from({ length: 12 }, (_, i) => itemIdOf(concept, i + 1)),
              formats: ['mcq', 'short', 'cloze', 'code_task', 'essay'],
              correct_count: correct,
              cbm_ratio: Math.round((correct / 12) * 1000) / 1000,
              passed: correct >= 9,
              profile: { policy_version: b.policy_version, ai_mode: 'OFFLINE', sp1_state: 'unknown' },
              study_day: b.study_day,
            },
          },
        };
      }
      case 'promote': {
        const track = p.pick(['net', 'k8s', 'lang']);
        const level = (this.nextLevel.get(track) ?? 0) + 1;
        if (level > 5) {
          return null;
        }
        const provisional = this.promoted.length === 0 || p.next() < 0.4;
        return {
          draft: {
            type: 'level.promoted',
            idempotency_key: `promo:${track}:${level}`,
            payload: {
              track,
              from: level === 1 ? null : level - 1,
              to: level,
              provisional,
              basis: level === 1 ? 'placement' : 'promotion_exam',
              gates: [
                {
                  gate_id: 'REQUIRED_MASTERED',
                  label_ko: '필수 개념 숙달',
                  met: true,
                  value: 0.9,
                  threshold: 0.85,
                  evidence_event_ids: [],
                  shortfall_ko: null,
                },
                {
                  gate_id: 'ASSESSMENT_ACCURACY',
                  label_ko: '평가 정확도',
                  met: true,
                  value: 0.75,
                  threshold: 0.7,
                  evidence_event_ids: [],
                  shortfall_ko: null,
                },
              ],
              profile: { policy_version: b.policy_version, ai_mode: 'OFFLINE', sp1_state: 'unknown' },
              study_day: b.study_day,
            },
          },
          after: () => {
            this.nextLevel.set(track, level);
            if (provisional) {
              this.promoted.push({ track, level, resolved: false });
            }
          },
        };
      }
      case 'resolve': {
        const open = this.promoted.filter((x) => !x.resolved);
        if (open.length === 0) {
          return null;
        }
        const target = p.pick(open);
        const key = `${target.track}:${target.level}`;
        const n = (this.resolveCount.get(key) ?? 0) + 1;
        const revoked = p.next() < 0.3;
        return {
          draft: {
            type: 'level.provisional_resolved',
            idempotency_key: `promo-res:${target.track}:${target.level}:${n}`,
            payload: {
              track: target.track,
              level: target.level,
              outcome: revoked ? 'provisional_revoked' : 'confirmed',
              needs_reconfirmation: revoked,
              regrade_verdict_ids: [actor.newId()],
              study_day: b.study_day,
            },
          },
          after: () => {
            target.resolved = true;
            this.resolveCount.set(key, n);
          },
        };
      }
      case 'upgrade':
      case 'regrade': {
        const pool = this.visibleGraded(actor, (g) => !g.superseded);
        const pendingPool = pool.filter((g) => g.spec.result === 'pending');
        const candidates = kind === 'regrade' && pendingPool.length > 0 ? pendingPool : pool;
        if (candidates.length === 0) {
          return null;
        }
        const target = p.pick(candidates);
        const wasPending = target.spec.result === 'pending';
        const newResult: VerdictResult = wasPending
          ? p.pick(['correct', 'partial', 'incorrect'] as const)
          : target.spec.result === 'correct'
            ? 'partial'
            : 'correct';
        const spec: VerdictSpec = {
          ...target.spec,
          verdict_id: actor.newId(),
          attempt_id: target.spec.attempt_id,
          result: newResult,
          issued_at: b.now,
          ai_mode: 'FULL',
        };
        const verdict = buildVerdict(spec);
        const payload: Record<string, unknown> = {
          ...carriedFields(verdict),
          supersedes_event_id: target.event_id,
          supersedes_verdict_id: target.spec.verdict_id,
          card_id: target.card_id,
          new_rating: verdict.recommended_grade,
          rating_applied: false,
          study_day: b.study_day,
          policy_version: b.policy_version,
        };
        if (kind === 'regrade') {
          payload.reason = wasPending ? 'pending_regrade' : 'appeal';
        }
        return {
          draft: {
            type: kind === 'upgrade' ? 'evidence.upgraded' : 'evidence.regraded',
            idempotency_key: `verdict:${spec.verdict_id}`,
            payload,
          },
          after: () => {
            target.superseded = true;
          },
        };
      }
      case 'void': {
        const pool = this.visibleGraded(actor, (g) => !g.corrected);
        if (pool.length === 0) {
          return null;
        }
        const first = p.pick(pool);
        const same = pool.filter(
          (g) => g.spec.concept_id === first.spec.concept_id && g.spec.item_n === first.spec.item_n,
        );
        const targets = same.slice(0, p.int(1, 3));
        const itemId = itemIdOf(first.spec.concept_id, first.spec.item_n);
        const basis = p.pick(['regate_g3', 'regate_g5', 'report', 'health', 'overlay', 'pack_upgrade'] as const);
        const gate = actor.newId();
        return {
          draft: {
            type: 'evidence.voided',
            idempotency_key: `corr:${itemId}:${basis}:${gate}`,
            payload: {
              item_id: itemId,
              target_event_ids: targets.map((g) => g.event_id),
              basis,
              correction: p.pick(['quarantined', 'demoted', 'key_fixed', 'retired'] as const),
              gate_result_id: gate,
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
          after: () => {
            for (const g of targets) {
              g.corrected = true;
            }
          },
        };
      }
      case 'weight': {
        const pool = this.visibleGraded(actor, (g) => !g.corrected);
        if (pool.length === 0) {
          return null;
        }
        const first = p.pick(pool);
        const targets = pool.filter((g) => g.spec.concept_id === first.spec.concept_id).slice(0, p.int(1, 3));
        if (p.next() < 0.6) {
          const itemId = itemIdOf(first.spec.concept_id, first.spec.item_n);
          const basis = p.pick(['regate_g3', 'report', 'overlay'] as const);
          const gate = actor.newId();
          return {
            draft: {
              type: 'evidence.weight_adjusted',
              idempotency_key: `corr:${itemId}:${basis}:${gate}`,
              payload: {
                target_event_ids: targets.map((g) => g.event_id),
                adjustment: { kind: 'factor', factor: 0.5 },
                cause: 'correction_halve',
                item_id: itemId,
                gate_result_id: gate,
                study_day: b.study_day,
                policy_version: b.policy_version,
              },
            },
            after: () => {
              for (const g of targets) {
                g.corrected = true;
              }
            },
          };
        }
        return {
          draft: {
            type: 'evidence.weight_adjusted',
            idempotency_key: `recalc:${b.policy_version}:${first.event_id}`,
            payload: {
              target_event_ids: targets.map((g) => g.event_id),
              adjustment: { kind: 'set', w_format: 0.6, w_grader: null, gaming_factor: 0.8 },
              cause: 'policy_recalc',
              item_id: null,
              gate_result_id: null,
              study_day: b.study_day,
              policy_version: b.policy_version,
            },
          },
          after: () => {
            for (const g of targets) {
              g.corrected = true;
            }
          },
        };
      }
    }
  }

  /** 토큰 목록: 쿼터 + 나머지 attempt, 셔플. 앞 40개는 attempt 고정(선행 증거 확보). */
  tokens(total: number, mix: SetSpec['mix']): Kind[] {
    const dependent: Kind[] = [];
    const rest: Kind[] = [];
    for (const [kind, n] of Object.entries(mix)) {
      for (let i = 0; i < (n ?? 0); i += 1) {
        (['upgrade', 'regrade', 'void', 'weight', 'resolve'].includes(kind) ? dependent : rest).push(kind as Kind);
      }
    }
    const warm = 40;
    const fill = total - dependent.length - rest.length - warm;
    if (fill < 0) {
      throw new Error('golden: mix exceeds total');
    }
    const body = this.prng.shuffle<Kind>([...rest, ...dependent, ...new Array<Kind>(fill).fill('attempt')]);
    return [...new Array<Kind>(warm).fill('attempt'), ...body];
  }
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string; detail: string } }): T {
  if (!r.ok) {
    throw new Error(`golden: ledger fault ${r.error.kind}: ${r.error.detail}`);
  }
  return r.value;
}

async function generate(set: GoldenSetName, dbDir: string | null): Promise<GeneratedGolden> {
  const spec = GOLDEN_SPECS[set];
  const prng = createPrng(spec.seed);
  const timeline = new Timeline(prng);
  const twoDevice = set === 'two-device';
  const gen = new Generator(prng, timeline, twoDevice);
  const dbPath = (name: string): string => (dbDir === null ? ':memory:' : path.join(dbDir, `${set}-${name}.db`));
  const a = makeActor(0, await openGoldenDb(dbPath('a')), 0);
  const b = twoDevice ? makeActor(1, await openGoldenDb(dbPath('b')), 500_000) : null;
  const actors = b === null ? [a] : [a, b];
  const queue = gen.tokens(spec.target - CARD_COUNT - 1, spec.mix);
  const deferrals = new Map<number, number>();

  const run = (kind: Kind, actor: Actor, t: number): boolean => {
    actor.clock.set(t);
    const built = gen.build(kind, actor);
    if (built === null) {
      return false;
    }
    const res = must(actor.writer.append(built.draft));
    if (res.kind !== 'appended') {
      throw new Error(`golden: unexpected duplicate for ${built.draft.type}`);
    }
    built.after?.(res.event);
    return true;
  };

  // 카드 등록(첫 append가 policy.switched를 먼저 만든다).
  const t0 = timeline.next();
  for (const card of gen.cards) {
    a.clock.set(t0);
    const res = must(a.writer.append(gen.enrollDraft(card, a)));
    if (res.kind !== 'appended') {
      throw new Error('golden: unexpected duplicate enrollment');
    }
  }

  const phase1End = twoDevice ? Math.floor(queue.length * 0.25) : queue.length;
  let cursor = 0;
  let serial = 0;
  const take = (actor: Actor, t: number): void => {
    const slot = serial;
    serial += 1;
    const queued = queue[cursor];
    cursor += 1;
    if (queued === undefined) {
      return;
    }
    let kind: Kind = queued;
    while (!run(kind, actor, t)) {
      const used = (deferrals.get(slot) ?? 0) + 1;
      deferrals.set(slot, used);
      if (used > 2 || kind === 'attempt') {
        kind = 'attempt';
      } else {
        // 선행 이벤트가 아직 없으면 이 칸은 attempt로 채우고, 원래 종류는 큐 뒤쪽 attempt 칸과 바꿔 미룬다(총 건수 불변).
        const later = queue.lastIndexOf('attempt');
        if (later > cursor) {
          queue[later] = kind;
        }
        kind = 'attempt';
      }
    }
  };

  while (cursor < phase1End) {
    take(a, timeline.next());
  }
  if (b !== null) {
    const reader = createLedgerReplayReader();
    const phase1 = [...reader.replay(a.db)];
    b.db.tx(() => must(b.writer.importInTx(phase1)));
    gen.afterSplit = true;
    while (cursor < queue.length) {
      const t = timeline.next();
      const r = prng.next();
      if (r < 0.25 && cursor + 1 < queue.length) {
        take(a, t);
        take(b, t); // 같은 시각 — 서로 다른 기기의 동일 client_ts 쌍
      } else {
        take(r < 0.62 ? a : b, t);
      }
    }
    const all = [...reader.replay(b.db)];
    a.db.tx(() => must(a.writer.importInTx(all)));
  }

  // 체크포인트(앵커 ①) + export 파일.
  const checkpoint = a.db.tx(() => createCheckpoint(a.db, { clock: a.clock, newId: a.newId }, 'export'));
  const localRow = a.db.prepare(LR_DEVICE_LOCAL).get();
  const events = readExportEvents(a.db);
  const header = {
    kind: 'header' as const,
    format: 'fathom.ledger.v1' as const,
    app_version: '1.0.0',
    created_at: a.clock.now(),
    source_device_id: localRow === undefined ? null : String(localRow.device_id),
    since_checkpoint_id: null,
    checkpoint_id: checkpoint.checkpoint_id,
    devices: checkpoint.devices,
    root_hash: checkpoint.root_hash,
  };
  const ledger = serializeLedgerJsonl(header, events);
  const types: Record<string, number> = {};
  for (const e of events) {
    types[e.type] = (types[e.type] ?? 0) + 1;
  }
  const meta: GoldenMeta = {
    format: 'fathom.golden-ledger.v1',
    set,
    seed: spec.seed,
    events: events.length,
    devices: checkpoint.devices,
    root_hash: checkpoint.root_hash,
    types: Object.fromEntries(Object.entries(types).sort(([x], [y]) => (x < y ? -1 : 1))),
    ledger_sha256: sha256Hex(ledger),
    generated_by: GENERATED_BY,
  };
  for (const actor of actors) {
    actor.db.close();
  }
  return { ledger, meta, metaText: `${JSON.stringify(meta, null, 2)}\n` };
}

/** 같은 시드 → 같은 바이트. `dbDir`가 null이면 `:memory:`(단위 테스트), 아니면 그 디렉터리의 파일 DB. */
export function generateGoldenSet(set: GoldenSetName, dbDir: string | null = null): Promise<GeneratedGolden> {
  return generate(set, dbDir);
}

export function goldenPaths(set: GoldenSetName): { ledger: string; meta: string } {
  return { ledger: path.join(GOLDEN_DIR, set, 'ledger.jsonl'), meta: path.join(GOLDEN_DIR, set, 'meta.json') };
}

async function main(): Promise<number> {
  const update = process.argv.includes('--update-golden');
  const home = await createTempHome('fathom-golden-');
  let failed = 0;
  try {
    for (const set of GOLDEN_SET_NAMES) {
      const made = await generateGoldenSet(set, home.path);
      const where = goldenPaths(set);
      if (update) {
        await mkdir(path.dirname(where.ledger), { recursive: true });
        await writeFile(where.ledger, made.ledger);
        await writeFile(where.meta, made.metaText);
        process.stdout.write(`golden ${set}: wrote ${made.meta.events} events root_hash=${made.meta.root_hash}\n`);
        continue;
      }
      const committedLedger = await readFile(where.ledger, 'utf8').catch(() => null);
      const committedMeta = await readFile(where.meta, 'utf8').catch(() => null);
      const same = committedLedger === made.ledger && committedMeta === made.metaText;
      process.stdout.write(`golden ${set}: ${same ? 'identical' : 'DIFFERS'} (${made.meta.events} events)\n`);
      if (!same) {
        failed += 1;
      }
    }
  } finally {
    await home.cleanup();
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  process.exitCode = await main();
}
