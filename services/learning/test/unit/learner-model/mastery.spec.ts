import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { describe, expect, it } from 'vitest';
import { sigmoid } from '../../../src/domain/learner-model/elo/elo.js';
import { shrunkTheta } from '../../../src/domain/learner-model/elo/theta.js';
import { evidenceWeight, isRapid, tMinMs } from '../../../src/domain/learner-model/mastery/evidence.js';
import {
  countsAsFormatEvidence,
  geq,
  initialConceptState,
  masteryOf,
  meanBeta,
} from '../../../src/domain/learner-model/mastery/mastery.js';
import { foldEvents } from '../../../src/domain/learner-model/projector/apply.js';
import { buildCorrectionIndex, EMPTY_CORRECTIONS } from '../../../src/domain/learner-model/projector/corrections.js';
import type {
  ConceptState,
  ProjectionSlice,
  ProjectorParams,
} from '../../../src/domain/learner-model/projector/types.js';
import { DAY, EventFactory, STUDY_DAY_1, STUDY_DAY_2, T0 } from './support/events.js';
import { FAKE_DB, MemoryResolver, runReplay, sliceHash } from './support/memory.js';
import { GAMING, MASTERY, makeParams, REPO_PARAMS } from './support/policy.js';

const FORMATS = ['short', 'cloze', 'code_task'] as const;
const resolver = new MemoryResolver([REPO_PARAMS]);

function fold(events: readonly LedgerEventEnvelope[], index = EMPTY_CORRECTIONS, r = resolver): ProjectionSlice {
  return foldEvents(events, (ps) => r.resolve(FAKE_DB, ps), index);
}
function concept(slice: ProjectionSlice): ConceptState {
  const c = slice.concepts['k8s.probes'];
  if (c === undefined) {
    throw new Error('concept missing');
  }
  return c.state;
}
function correctRun(
  count: number,
  pick: (i: number) => { format: string; study_day: string; ts: number },
): LedgerEventEnvelope[] {
  const f = new EventFactory();
  const events: LedgerEventEnvelope[] = [f.enrolled({ ts: T0 })];
  for (let i = 0; i < count; i += 1) {
    const { format, study_day, ts } = pick(i);
    events.push(f.graded({ ts }, { format, study_day }));
  }
  return events;
}

describe('learner-model 숙달 — 형식 산입 · 학습일 · ε', () => {
  it('UT-LR-108 숙달 = p ≥ .80 ∧ 형식 ≥ 3 ∧ 서로 다른 study_day ≥ 2(UTC 같은 날·학습일 다른 날 사례 포함) [FR-PRG-009]', () => {
    const days = [STUDY_DAY_1, STUDY_DAY_2];
    // 24건 정답, 3형식, UTC로는 같은 날(수 초 간격)이지만 study_day는 두 날 → 숙달
    const sameUtcDay = concept(
      fold(
        correctRun(24, (i) => ({
          format: FORMATS[i % 3] ?? 'short',
          study_day: days[i % 2] ?? STUDY_DAY_1,
          ts: T0 + 1 + i * 1000,
        })),
      ),
    );
    expect(sameUtcDay.study_days).toEqual(days);
    expect(sameUtcDay.mastery.p).toBeGreaterThanOrEqual(0.8);
    expect(sameUtcDay.mastery.mastered).toBe(true);
    // 역: client_ts는 사흘에 걸쳐도 study_day가 하나뿐 → 1일 → 미숙달
    const oneStudyDay = concept(
      fold(
        correctRun(24, (i) => ({
          format: FORMATS[i % 3] ?? 'short',
          study_day: STUDY_DAY_1,
          ts: T0 + 1 + i * 3 * 3_600_000,
        })),
      ),
    );
    expect(oneStudyDay.study_days).toEqual([STUDY_DAY_1]);
    expect(oneStudyDay.mastery.p).toBeGreaterThanOrEqual(0.8);
    expect(oneStudyDay.mastery.mastered).toBe(false);
    // 형식 2개뿐 → 미숙달
    const twoFormats = concept(
      fold(
        correctRun(24, (i) => ({
          format: FORMATS[i % 2] ?? 'short',
          study_day: days[i % 2] ?? STUDY_DAY_1,
          ts: T0 + 1 + i * 1000,
        })),
      ),
    );
    expect(Object.keys(twoFormats.credited_formats)).toHaveLength(2);
    expect(twoFormats.mastery.mastered).toBe(false);
    // p 미달(10건) → 미숙달
    const early = concept(
      fold(
        correctRun(10, (i) => ({
          format: FORMATS[i % 3] ?? 'short',
          study_day: days[i % 2] ?? STUDY_DAY_1,
          ts: T0 + 1 + i * 1000,
        })),
      ),
    );
    expect(early.mastery.p).toBeLessThan(0.8);
    expect(early.mastery.mastered).toBe(false);
    // masteryOf는 순수 조합(고정 입력)
    const base: ConceptState = {
      ...initialConceptState(MASTERY),
      theta: 4,
      theta_q: 4,
      n_graded: 100,
      credited_formats: { a: 'e1', b: 'e2', c: 'e3' },
      study_days: [STUDY_DAY_1, STUDY_DAY_2],
    };
    expect(masteryOf(base, MASTERY).mastered).toBe(true);
    expect(masteryOf({ ...base, credited_formats: { a: 'e1', b: 'e2' } }, MASTERY).mastered).toBe(false);
    expect(masteryOf({ ...base, study_days: [STUDY_DAY_1] }, MASTERY).mastered).toBe(false);
    expect(masteryOf({ ...base, theta: -3, theta_q: -3 }, MASTERY).mastered).toBe(false);
  });

  it('UT-LR-109 geq ε 경계(0.7 − 1e-10 산입, 0.7 − 1e-8 불산입) [FR-PRG-009]', () => {
    expect(MASTERY.epsilon).toBe(1e-9);
    expect(geq(0.7 - 1e-10, 0.7, MASTERY.epsilon)).toBe(true);
    expect(geq(0.7 - 1e-8, 0.7, MASTERY.epsilon)).toBe(false);
    expect(geq(0.7, 0.7, MASTERY.epsilon)).toBe(true);
    const f = new EventFactory();
    const credited = (wFormat: number): number =>
      Object.keys(
        concept(fold([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { w_format: wFormat })])).credited_formats,
      ).length;
    expect(credited(0.7 - 1e-10)).toBe(1);
    expect(credited(0.7 - 1e-8)).toBe(0);
    const credited6 = (wGrader: number): number =>
      Object.keys(
        concept(fold([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { w_grader: wGrader })])).credited_formats,
      ).length;
    expect(credited6(0.6 - 1e-10)).toBe(1);
    expect(credited6(0.6 - 1e-8)).toBe(0);
  });

  it('UT-LR-111 tMinMs·isRapid + rapid 이벤트는 정오 무관 w = 0(θ·n 불변) [FR-QST-025]', () => {
    // t_min = max(floor_ms, base_ms + 글자 수 ÷ chars_per_s × 1000): ox = floor 1200 · base 400 · 25 chars/s
    expect(tMinMs('ox', 100, GAMING)).toBe(4400);
    expect(tMinMs('ox', 0, GAMING)).toBe(1200);
    expect(isRapid(4399, 4400)).toBe(true);
    expect(isRapid(4400, 4400)).toBe(false);
    expect(evidenceWeight({ w_format: 0.8, w_grader: 0.9, gaming_factor: 0.5, rapid: false })).toBeCloseTo(0.36, 12);
    expect(evidenceWeight({ w_format: 1, w_grader: 1, gaming_factor: 1, rapid: true })).toBe(0);
    const f = new EventFactory();
    for (const result of ['correct', 'incorrect'] as const) {
      const s = concept(fold([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { rapid: true, result })]));
      expect(s).toMatchObject({ theta: MASTERY.theta_shrink.theta_prior, n: 0, n_q: 0, w_sum: 0, n_graded: 1 });
      expect(s.credited_formats).toEqual({}); // rapid는 형식 산입도 없다
    }
  });
});

describe('learner-model 숙달·정정 규칙', () => {
  it('UT-LR-140 형식 산입 6조건 각각 음성 [FR-PRG-009]', () => {
    const ok = {
      result: 'correct',
      pending: false,
      rapid: false,
      gaming_factor: 1,
      w_format: 1,
      w_grader: 1,
      format: 'short',
    } as const;
    expect(countsAsFormatEvidence(ok, MASTERY)).toBe(true);
    expect(countsAsFormatEvidence({ ...ok, result: 'partial' }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, result: 'incorrect' }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, pending: true }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, rapid: true }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, gaming_factor: 0 }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, w_format: 0.69 }, MASTERY)).toBe(false);
    expect(countsAsFormatEvidence({ ...ok, w_grader: 0.59 }, MASTERY)).toBe(false);
    // 리듀서 경유: 어느 하나라도 걸리면 credited_formats·study_days 변화 0
    const f = new EventFactory();
    for (const variant of [
      { result: 'partial' as const },
      { result: 'pending' as const },
      { rapid: true },
      { gaming_factor: 0 },
      { w_format: 0.69 },
      { w_grader: 0.59 },
    ]) {
      const s = concept(fold([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, variant)]));
      expect(s.credited_formats).toEqual({});
      expect(s.study_days).toEqual([]);
    }
  });

  it('UT-LR-141 supersede 시 study_day = 원 이벤트 값, 형식 = 처음 산입한 루트 event_id [FR-PRG-009]', () => {
    const f = new EventFactory();
    const graded = f.graded({ ts: T0 + 1 }, { result: 'incorrect', study_day: STUDY_DAY_1, format: 'mcq' });
    const upgraded = f.upgraded({ ts: T0 + 2 * DAY }, graded.event_id, {
      result: 'correct',
      format: 'mcq',
      study_day: STUDY_DAY_2,
    });
    const events = [f.enrolled({ ts: T0 }), graded, upgraded];
    const s = concept(fold(events, buildCorrectionIndex(events)));
    expect(s.study_days).toEqual([STUDY_DAY_1]); // 대체 이벤트 생성일(STUDY_DAY_2)이 아님
    expect(s.credited_formats).toEqual({ mcq: graded.event_id });
  });

  it('UT-LR-142 first_mastered_ts는 처음 참이 된 client_ts, 이후 거짓이 돼도 유지 [FR-PRG-009]', () => {
    const easy: ProjectorParams = makeParams({
      mastery: (m) => ({ ...m, mastery: { ...m.mastery, p_min: 0.5, formats_min: 1, distinct_days_min: 1 } }),
    });
    const r = new MemoryResolver([easy]);
    const f = new EventFactory();
    const ps = { policy_version: easy.policy_version };
    const events: LedgerEventEnvelope[] = [f.enrolled({ ts: T0 }, ps)];
    let firstTs: number | null = null;
    let ts = T0;
    for (let i = 0; i < 60 && firstTs === null; i += 1) {
      ts += 1000;
      events.push(f.graded({ ts }, ps));
      const s = concept(fold(events, EMPTY_CORRECTIONS, r));
      if (s.mastery.mastered) {
        firstTs = ts;
        expect(s.first_mastered_ts).toBe(ts);
      }
    }
    expect(firstTs).not.toBeNull();
    for (let i = 0; i < 80; i += 1) {
      ts += 1000;
      events.push(f.graded({ ts }, { ...ps, result: 'incorrect' }));
    }
    const after = concept(fold(events, EMPTY_CORRECTIONS, r));
    expect(after.mastery.mastered).toBe(false);
    expect(after.first_mastered_ts).toBe(firstTs);
  });

  it('UT-LR-143 β̄ = Σ w·β ÷ Σ w 가중 평균, p = σ(θ̃ − β̄) [FR-PRG-009]', () => {
    const f = new EventFactory();
    const s = concept(
      fold([
        f.enrolled({ ts: T0 }),
        f.graded({ ts: T0 + 1 }, { item_beta: 1 }), // w = 1
        f.graded({ ts: T0 + 2 }, { item_beta: 3, w_format: 0.5 }), // w = 0.5
      ]),
    );
    expect(s.w_sum).toBeCloseTo(1.5, 12);
    expect(s.beta_wsum).toBeCloseTo(1 * 1 + 0.5 * 3, 12);
    expect(meanBeta(s)).toBeCloseTo(2.5 / 1.5, 12);
    expect(s.mastery.p).toBeCloseTo(sigmoid(shrunkTheta(s, MASTERY) - 2.5 / 1.5), 12);
    expect(meanBeta({ w_sum: 0, beta_wsum: 0 })).toBe(0);
  });

  it('UT-LR-144 evidence.voided → 카드·개념 모두 제외(원 이벤트가 없는 것과 같다) [FR-PRG-002][NFR-DATA-011]', () => {
    const f = new EventFactory();
    const enrolled = f.enrolled({ ts: T0 });
    const g1 = f.graded({ ts: T0 + 1000 }, { rating: 3 });
    const g2 = f.graded({ ts: T0 + 2000 }, { rating: 4, item_beta: 0.7 });
    const g3 = f.graded({ ts: T0 + 3000 }, { rating: 3, result: 'incorrect' });
    const voided = f.voided({ ts: T0 + 4000 }, [g2.event_id]);
    const withVoid = runReplay([enrolled, g1, g2, g3, voided], resolver);
    const without = runReplay([enrolled, g1, g3], resolver);
    expect(sliceHash(withVoid)).toBe(sliceHash(without));
    expect(concept(withVoid).n_graded).toBe(2);
    expect(withVoid.cards['k8s.probes:concept:p']?.state.reps).toBe(2);
    // 두 기기 도착 순서·정정이 앞서 도착해도 같은 결과(리플레이는 인덱스 먼저)
    expect(sliceHash(runReplay([voided, g3, g2, g1, enrolled], resolver))).toBe(sliceHash(without));
  });

  it('UT-LR-145 weight_adjusted factor·set(null 성분 유지)을 총순서대로 적용 [FR-PRG-002][NFR-DATA-011]', () => {
    const f = new EventFactory();
    const enrolled = f.enrolled({ ts: T0 });
    const g = f.graded({ ts: T0 + 1000 }, { w_format: 0.8, w_grader: 0.9, gaming_factor: 1, item_beta: 0.4 });
    const half = f.weightAdjusted({ ts: T0 + 2000 }, [g.event_id], { kind: 'factor', factor: 0.5 });
    const set = f.weightAdjusted({ ts: T0 + 3000 }, [g.event_id], {
      kind: 'set',
      w_format: 0.6,
      w_grader: null,
      gaming_factor: null,
    });
    // 기대: 최종 가중치 = w_format .6 · w_grader .9 · gaming .5(set이 factor 뒤 — null은 유지)
    const direct = [
      enrolled,
      f.graded({ ts: T0 + 1000 }, { w_format: 0.6, w_grader: 0.9, gaming_factor: 0.5, item_beta: 0.4 }),
    ];
    const adjusted = runReplay([enrolled, g, half, set], resolver);
    expect(concept(adjusted)).toEqual(concept(fold(direct)));
    // 순서가 뒤집히면(set 먼저 → factor 나중) 결과가 달라야 한다 = 총순서가 실제로 쓰인다
    const swapped = f.weightAdjusted({ ts: T0 + 2500 }, [g.event_id], {
      kind: 'set',
      w_format: null,
      w_grader: null,
      gaming_factor: 1,
    });
    const orderMatters = runReplay([enrolled, g, half, swapped], resolver); // factor(.5) → set(gaming 1)
    expect(concept(orderMatters).w_sum).toBeCloseTo(0.8 * 0.9 * 1, 12);
    const reversed = runReplay(
      [
        enrolled,
        g,
        f.weightAdjusted({ ts: T0 + 1500 }, [g.event_id], {
          kind: 'set',
          w_format: null,
          w_grader: null,
          gaming_factor: 1,
        }),
        f.weightAdjusted({ ts: T0 + 2000 }, [g.event_id], { kind: 'factor', factor: 0.5 }),
      ],
      resolver,
    );
    expect(concept(reversed).w_sum).toBeCloseTo(0.8 * 0.9 * 0.5, 12); // set(1) → factor(.5)
    // 도착 순서 무관
    expect(sliceHash(runReplay([set, half, g, enrolled], resolver))).toBe(sliceHash(adjusted));
  });

  it('UT-LR-146 upgraded → regraded 사슬 = 마지막이 원 위치에 반영, FSRS 불변 [FR-PRG-002][NFR-DATA-011]', () => {
    const f = new EventFactory();
    const enrolled = f.enrolled({ ts: T0 });
    const g = f.graded({ ts: T0 + 1000 }, { result: 'incorrect', rating: 2, format: 'mcq' });
    const up = f.upgraded({ ts: T0 + 2000 }, g.event_id, { result: 'partial', format: 'mcq', new_rating: 3 });
    const re = f.regraded({ ts: T0 + 3000 }, up.event_id, { result: 'correct', format: 'mcq', new_rating: 4 });
    const chained = runReplay([enrolled, g, up, re], resolver);
    // 개념: 마지막(correct)이 원 위치에 반영 = 처음부터 correct였던 것과 같다
    const asIfCorrect = runReplay(
      [enrolled, f.graded({ ts: T0 + 1000 }, { result: 'correct', rating: 2, format: 'mcq' })],
      resolver,
    );
    expect(concept(chained).theta).toBeCloseTo(concept(asIfCorrect).theta, 12);
    expect(concept(chained).credited_formats).toEqual({ mcq: g.event_id });
    // 카드(FSRS): 원 rating 2 그대로 — new_rating(3·4)은 반영되지 않는다(rating_applied: false)
    expect(chained.cards['k8s.probes:concept:p']?.state).toEqual(asIfCorrect.cards['k8s.probes:concept:p']?.state);
    // last_ts는 대체 이벤트 자기 위치에서도 갱신
    expect(chained.cards['k8s.probes:concept:p']?.last_ts).toBe(T0 + 3000);
    // 도착 순서 무관
    expect(sliceHash(runReplay([re, up, g, enrolled], resolver))).toBe(sliceHash(chained));
  });

  it('UT-LR-147 buildCorrectionIndex 루트 정규화(사슬 대상 void)·순서 무관·무관 타입 무시 [FR-PRG-002][NFR-DATA-011]', () => {
    const f = new EventFactory();
    const g = f.graded({ ts: T0 + 1000 }, {});
    const up = f.upgraded({ ts: T0 + 2000 }, g.event_id, {});
    const re = f.regraded({ ts: T0 + 3000 }, up.event_id, {});
    const voidChain = f.voided({ ts: T0 + 4000 }, [re.event_id]); // 사슬 끝을 가리키는 무효
    const adj = f.weightAdjusted({ ts: T0 + 5000 }, [up.event_id], { kind: 'factor', factor: 0.5 });
    const noise = f.enrolled({ ts: T0 });
    const all = [g, up, re, voidChain, adj, noise];
    const idx = buildCorrectionIndex(all);
    expect([...idx.voided]).toEqual([g.event_id]);
    expect([...idx.adjustments.keys()]).toEqual([g.event_id]);
    expect(idx.adjustments.get(g.event_id)?.[0]?.adjustment).toEqual({ kind: 'factor', factor: 0.5 });
    expect(idx.latestSupersede.get(g.event_id)?.event_id).toBe(re.event_id);
    expect(idx.rootOf.get(up.event_id)).toBe(g.event_id);
    expect(idx.rootOf.get(re.event_id)).toBe(g.event_id);
    // 입력 순서 무관
    const shuffled = buildCorrectionIndex([noise, adj, voidChain, re, up, g]);
    expect([...shuffled.voided]).toEqual([...idx.voided]);
    expect([...shuffled.rootOf].sort()).toEqual([...idx.rootOf].sort());
    expect(shuffled.latestSupersede.get(g.event_id)?.event_id).toBe(re.event_id);
    // 정정 없음 → 빈 인덱스 재사용
    expect(buildCorrectionIndex([g, noise])).toBe(EMPTY_CORRECTIONS);
    // 사슬 순환 = 결함
    const a = f.upgraded({ ts: T0 + 6000 }, 'X'.padEnd(26, '0'), {});
    const b = f.upgraded({ ts: T0 + 7000 }, a.event_id, {});
    const cyc = { ...a, payload: { ...a.payload, supersedes_event_id: b.event_id } };
    expect(() => buildCorrectionIndex([cyc, b])).toThrow(/supersede cycle/);
  });
});
