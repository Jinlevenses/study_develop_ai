import { describe, expect, it } from 'vitest';
import {
  AiMode,
  Confidence,
  DataClass,
  Energy,
  Facet,
  FormatId,
  FsrsRating,
  GraderEngine,
  JudgeBadge,
  Level,
  Lifecycle,
  Locale,
  MasteryStatus,
  ModeId,
  ProviderKind,
  ProviderStatus,
  ResponseMode,
  RuntimeProfile,
  ServiceState,
  SessionMinutes,
  SlotId,
  Sp1State,
  Stakes,
  Tag,
  Tier,
  Volatility,
} from '../../../src/common/domain.js';
import { DurationMs, EpochMs, IsoWeek, StudyDay } from '../../../src/common/time.js';

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('common/time', () => {
  it('UT-CON-016 EpochMs·DurationMs·StudyDay·IsoWeek는 정규식 그대로다(2026-02-30은 정규식상 통과) [NFR-DATA-001]', () => {
    expect(ok(EpochMs, 0)).toBe(true);
    expect(ok(EpochMs, 1_759_000_000_000)).toBe(true);
    expect(ok(EpochMs, 8_640_000_000_000_000)).toBe(true);
    expect(ok(EpochMs, 8_640_000_000_000_001)).toBe(false);
    expect(ok(EpochMs, -1)).toBe(false);
    expect(ok(EpochMs, 1.5)).toBe(false);
    expect(ok(EpochMs, '1')).toBe(false);
    expect(ok(DurationMs, 0)).toBe(true);
    expect(ok(DurationMs, -1)).toBe(false);
    expect(ok(DurationMs, 0.1)).toBe(false);
    expect(ok(StudyDay, '2026-10-01')).toBe(true);
    expect(ok(StudyDay, '2026-02-30')).toBe(true); // 달력 검증은 하지 않는다 — 정규식 그대로
    expect(ok(StudyDay, '2026-13-01')).toBe(false);
    expect(ok(StudyDay, '2026-00-10')).toBe(false);
    expect(ok(StudyDay, '2026-10-32')).toBe(false);
    expect(ok(StudyDay, '2026-1-01')).toBe(false);
    expect(ok(IsoWeek, '2026-W40')).toBe(true);
    expect(ok(IsoWeek, '2026-W53')).toBe(true);
    expect(ok(IsoWeek, '2026-W54')).toBe(false);
    expect(ok(IsoWeek, '2026-W00')).toBe(false);
    expect(ok(IsoWeek, '2026-40')).toBe(false);
  });
});

describe('common/domain', () => {
  it('UT-CON-017 FormatId는 33종이고 중복이 없다 [IR-015]', () => {
    expect(FormatId.options).toHaveLength(33);
    expect(new Set(FormatId.options).size).toBe(33);
    for (const f of [
      'embedded',
      'ox',
      'mcq',
      'mcq_multi',
      'order',
      'parsons',
      'log_read',
      'config_review',
      'ml_predict',
    ]) {
      expect(ok(FormatId, f), f).toBe(true);
    }
    expect(ok(FormatId, 'MCQ')).toBe(false);
    expect(ok(FormatId, 'unknown_format')).toBe(false);
  });

  it('UT-CON-018 ModeId는 M-01~M-21만 받는다 [FR-STD-033]', () => {
    for (let i = 1; i <= 21; i += 1) {
      expect(ok(ModeId, `M-${String(i).padStart(2, '0')}`), `M-${i}`).toBe(true);
    }
    for (const bad of ['M-00', 'M-22', 'M-1', 'M-001', 'm-01', 'M01', 'M-30']) {
      expect(ok(ModeId, bad), bad).toBe(false);
    }
  });

  it('UT-CON-019 숫자·열거 스칼라와 Facet·Tag 경계 [IR-015]', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(ok(Level, v)).toBe(true);
    }
    expect(ok(Level, 0)).toBe(false);
    expect(ok(Level, 6)).toBe(false);
    expect(ok(Level, 1.5)).toBe(false);
    expect(Tier.options).toEqual(['A', 'B', 'C']);
    expect(Stakes.options).toEqual(['S0', 'S1', 'S2']);
    expect(AiMode.options).toEqual(['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE']);
    expect(ResponseMode.options).toEqual(['recognition', 'production']);
    expect(SlotId.options).toEqual(['W', 'R', 'N', 'D', 'S', 'C']);
    expect(Energy.options).toEqual(['light', 'normal', 'deep']);
    expect(Lifecycle.options).toHaveLength(10);
    expect(MasteryStatus.options).toEqual(['unseen', 'learning', 'mastered']);
    expect(Sp1State.options).toEqual(['pass', 'fail', 'unknown']);
    expect(Volatility.options).toEqual(['stable', 'evolving', 'volatile']);
    expect(ProviderKind.options).toEqual(['jev', 'llm_api', 'llm_cli', 'generic_cli', 'local_llm']);
    expect(ProviderStatus.options).toEqual(['ok', 'degraded', 'down', 'unconsented', 'disabled']);
    expect(GraderEngine.options).toEqual(['D', 'J', 'LJ', 'H', 'S', 'PENDING']);
    expect(JudgeBadge.options).toHaveLength(8);
    expect(DataClass.options).toEqual(['C0', 'C1', 'C2', 'C3']);
    expect(RuntimeProfile.options).toEqual(['prod', 'dev', 'test']);
    expect(ServiceState.options).toEqual(['starting', 'ready', 'restarting', 'degraded', 'stopped']);
    for (const m of [5, 15, 25, 45, 90]) {
      expect(ok(SessionMinutes, m)).toBe(true);
    }
    expect(ok(SessionMinutes, 30)).toBe(false);
    expect(ok(Confidence, 3)).toBe(true);
    expect(ok(Confidence, 4)).toBe(false);
    expect(ok(FsrsRating, 4)).toBe(true);
    expect(ok(FsrsRating, 0)).toBe(false);
    expect(ok(Locale, 'ko')).toBe(true);
    expect(ok(Locale, 'en')).toBe(false);
    for (const f of ['concept', 'code', 'ops', 'tradeoff', 'a']) {
      expect(ok(Facet, f), f).toBe(true);
    }
    for (const f of ['Concept', '1code', '', 'a'.repeat(33), 'a-b']) {
      expect(ok(Facet, f), f).toBe(false);
    }
    for (const t of ['cert:cka', 'ctx:si', 'qa:performance', 'mode:m-03']) {
      expect(ok(Tag, t), t).toBe(true);
    }
    for (const t of ['cert:', 'foo:bar', 'cert:CKA', 'cert']) {
      expect(ok(Tag, t), t).toBe(false);
    }
  });
});
