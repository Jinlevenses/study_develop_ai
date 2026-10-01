import { describe, expect, it } from 'vitest';
import { GateThresholdsV1 } from '../../../src/policy/gate_thresholds.js';
import { SearchParamsV1 } from '../../../src/policy/search_params.js';

// AI-01 §8.20 `policy/gate_thresholds@v1.yaml` 과 같은 값(YAML → 객체).
const gateThresholds = () => ({
  version: 'gate_thresholds@v1',
  gates: {
    G2: { grounded_min: 0.85 },
    G3: { key_min: 0.8, other_max: 0.2, repair_band: { gt: 0.2, le: 0.5 } },
    G4: { require_key_match: true },
    G5: { ambiguous_max: 0.25 },
    G6: { mean_min: 1.5, each_min: 0.5 },
    G7: { leak_max: 0.3 },
    G8: { duplicate_min: 0.9, judge_band: { ge: 0.7, lt: 0.9 }, same_knowledge_min: 0.7 },
    G9: { target_p_min: 0.5, adjacent_ok: true },
    G11: { explanation_min: 2.0 },
    G13: { each_max: 0.1 },
    regate: { G3: 'void', G5: 'halve' },
    llm_only: {
      G2: { grounded_min: 0.85 },
      G3: { key_min: 0.85, other_max: 0.15 },
      G5: { ambiguous_max: 0.15 },
      G7: { leak_max: 0.15 },
      require_G4: true,
    },
  },
  judge_bands: {
    'AI-J01': { targets_mc: { accept: 0.7, reject: 0.4 } },
    'AI-J02': { equiv: { accept: 0.8, reject: 0.4 } },
    'AI-J03': {
      cov: { accept: 0.7, reject: 0.4 },
      mc: { present: 0.6 },
      bps: {
        w: { coverage: 0.4, accuracy: 0.25, structure: 0.2, depth: 0.15 },
        partial_credit: 0.5,
        deep_level_min: 2,
      },
    },
    'AI-J04': {
      kp: { accept: 0.7, reject: 0.4 },
      defect: { accept: 0.7, reject: 0.4 },
      mc: { present: 0.6 },
      partial_credit: 0.5,
    },
    'AI-J05': {
      fixes_mc: { accept: 0.6 },
      teaching: { w: { accuracy: 0.25, simplicity: 0.15, examples: 0.1, gaps: 0.2, fixes_mc: 0.3 }, taught_min: 0.8 },
    },
    'AI-J06': { which_mc: { confidence_min: 0.6 }, error_cause: { confidence_min: 0.6 } },
    'AI-J12': { same_concept: { merge_candidate_min: 0.7 } },
    'AI-J13': { section: { auto_min: 0.6 } },
    'AI-J14': { supported: { verified_min: 0.85 } },
    'AI-J15': { contradict: { conflict_min: 0.7, review_min: 0.4 } },
    'AI-J16': { injection: { quarantine_min: 0.5 } },
    'AI-J17': { label: { confidence_min: 0.6, below: 'partial' }, asks_answer: { flag: 0.6 } },
    'AI-J18': { gates_as: ['G2', 'G3', 'G5', 'G6'], centrality: { min: 2.0 } },
    'AI-J19': {
      appeal_label: { confidence_min: 0.6, confidence_min_judge_only: 0.75, below: 'user_decision_required' },
    },
    injection: { flag: 0.5 },
    jev_low_confidence: 0.6,
  },
});

// ARC-01 §10.4 `search_params@v1` 초기값(bm25 10·5·1, 짧은 토큰 3자, V3 전환 20,000).
const searchParams = () => ({
  version: 'search_params@v1',
  bm25: { title: 10, alias: 5, body: 1 },
  strip_chars: '"\'“”‘’.,;:!?()[]{}<>',
  short_token_len: 3,
  v3_switch_docs: 20000,
});

type Json = Record<string, unknown>;
const clone = (): Json => JSON.parse(JSON.stringify(gateThresholds())) as Json;

describe('content 정책 상세 zod (CR-43)', () => {
  it('UT-CON-128 GateThresholdsV1: AI-01 §8.20 YAML 값 통과, reject > accept 거부, bps.w 합 0.9 거부, 미지 키(G1) 거부 [FR-QST-003][NFR-MAINT-007]', () => {
    expect(GateThresholdsV1.safeParse(gateThresholds()).success).toBe(true);

    // Band: reject <= accept
    const badBand = clone();
    ((badBand.judge_bands as Json)['AI-J01'] as Json).targets_mc = { accept: 0.3, reject: 0.4 };
    expect(GateThresholdsV1.safeParse(badBand).success).toBe(false);
    const equalBand = clone();
    ((equalBand.judge_bands as Json)['AI-J01'] as Json).targets_mc = { accept: 0.4, reject: 0.4 };
    expect(GateThresholdsV1.safeParse(equalBand).success).toBe(true);

    // Weights4 합 = 1 ± 1e-9
    const badW4 = clone();
    (((badW4.judge_bands as Json)['AI-J03'] as Json).bps as Json).w = {
      coverage: 0.4,
      accuracy: 0.2,
      structure: 0.15,
      depth: 0.15,
    };
    expect(GateThresholdsV1.safeParse(badW4).success).toBe(false);
    // Weights5 합 ≠ 1
    const badW5 = clone();
    (((badW5.judge_bands as Json)['AI-J05'] as Json).teaching as Json).w = {
      accuracy: 0.25,
      simplicity: 0.15,
      examples: 0.1,
      gaps: 0.2,
      fixes_mc: 0.2,
    };
    expect(GateThresholdsV1.safeParse(badW5).success).toBe(false);

    // 미지 키: G1·G10·G12는 임계가 없어 키 자체가 없다
    for (const key of ['G1', 'G0', 'G10', 'G12']) {
      const extra = clone();
      (extra.gates as Json)[key] = { x: 1 };
      expect(GateThresholdsV1.safeParse(extra).success, key).toBe(false);
    }
    expect(GateThresholdsV1.safeParse({ ...gateThresholds(), extra: 1 }).success).toBe(false);
    expect(GateThresholdsV1.safeParse({ ...gateThresholds(), version: 'gate_thresholds@v2' }).success).toBe(false);

    // 비율 0~1, 점수 0~3, enum
    const badRatio = clone();
    (badRatio.gates as Json).G2 = { grounded_min: 1.2 };
    expect(GateThresholdsV1.safeParse(badRatio).success).toBe(false);
    const badScore = clone();
    (badScore.gates as Json).G11 = { explanation_min: 3.5 };
    expect(GateThresholdsV1.safeParse(badScore).success).toBe(false);
    const badRegate = clone();
    (badRegate.gates as Json).regate = { G3: 'drop', G5: 'halve' };
    expect(GateThresholdsV1.safeParse(badRegate).success).toBe(false);
    const missing = clone();
    delete (missing.gates as Json).G13;
    expect(GateThresholdsV1.safeParse(missing).success).toBe(false);
    const badGatesAs = clone();
    ((badGatesAs.judge_bands as Json)['AI-J18'] as Json).gates_as = ['G9'];
    expect(GateThresholdsV1.safeParse(badGatesAs).success).toBe(false);
    const emptyGatesAs = clone();
    ((emptyGatesAs.judge_bands as Json)['AI-J18'] as Json).gates_as = [];
    expect(GateThresholdsV1.safeParse(emptyGatesAs).success).toBe(false);
    const badBelow = clone();
    (((badBelow.judge_bands as Json)['AI-J17'] as Json).label as Json).below = 'fail';
    expect(GateThresholdsV1.safeParse(badBelow).success).toBe(false);
    const badDepth = clone();
    (((badDepth.judge_bands as Json)['AI-J03'] as Json).bps as Json).deep_level_min = 6;
    expect(GateThresholdsV1.safeParse(badDepth).success).toBe(false);
  });

  it('UT-CON-129 SearchParamsV1: ARC §10.4 값(bm25 10·5·1, short_token_len 3, v3_switch_docs 20000) 통과, bm25.body 0 거부 [FR-CUR-011]', () => {
    expect(SearchParamsV1.safeParse(searchParams()).success).toBe(true);
    const base = searchParams();
    expect(SearchParamsV1.safeParse({ ...base, bm25: { ...base.bm25, body: 0 } }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, bm25: { ...base.bm25, title: -1 } }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, bm25: { title: 10, alias: 5 } }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, strip_chars: '' }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, strip_chars: 'x'.repeat(201) }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, short_token_len: 0 }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, short_token_len: 11 }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, v3_switch_docs: 0 }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, v3_switch_docs: 1.5 }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(SearchParamsV1.safeParse({ ...base, version: 'search_params@v2' }).success).toBe(false);
  });
});
