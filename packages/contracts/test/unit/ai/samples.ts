// 테스트 전용 유효 샘플(무네트워크).
export const ULID = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
export const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';
export const SHA = 'a'.repeat(64);

export const contextRef = { kind: 'attempt', phase: 'post_submit', id: 'attempt-1' } as const;

export const judgeState = { key_points: { kp01: '핵심 하나', kp02: '핵심 둘' } };
export const judgeJobPayload = {
  state: judgeState,
  state_classes: { key_points: 'C0' },
  untrusted_keys: [],
  questions: { q01: { template: 'covered', vars: { kp: 'key_points.kp01' } } },
  calibrated_only: false,
  family_exclude: [],
  local_only: false,
};
export const generateJobPayload = { input: {}, blocks: [], family_exclude: [], local_only: false };

export const judgeRequest = {
  template_version: 'active',
  ...judgeJobPayload,
  lane: 'interactive',
  deadline_ms: 3000,
  context_ref: contextRef,
  work_order_id: null,
};

export const noulAnswer = { type: 'noul', p_yes: 0.9 } as const;
export const judgeOk = {
  status: 'ok',
  engine: 'J',
  calibrated: true,
  confidence: 0.9,
  answers: { q01: noulAnswer },
  model_version: 'jev-1',
  provider_id: 'jev',
  prompt_version: '1.0.0',
  judge_log_id: ULID,
  firewall_decision_id: ULID_B,
  cache_hit: false,
  latency_ms: 120,
};
