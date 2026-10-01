// 테스트 전용 유효 샘플(무네트워크).
export const ULID = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
export const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';
export const SHA = 'a'.repeat(64);

export const banner = {
  banner_id: ULID,
  code: 'ai_offline',
  severity: 'info',
  message_ko: 'AI가 꺼져 있습니다.',
  since: 1,
  dismissible: true,
  action: { label_ko: '설정', href: '/settings/ai', cli: null },
};

export const operation = {
  op_id: ULID,
  kind: 'backup',
  state: 'running',
  progress: { step: 'snapshot', pct: 40 },
  correlation_id: ULID_B,
  started_at: 1,
  finished_at: null,
  result: null,
  problem: null,
};
