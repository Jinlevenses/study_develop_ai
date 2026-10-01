import { describe, expect, it } from 'vitest';
import { GenerateTaskId, JudgeTaskId, SystemTaskId } from '../../../src/ai/tasks.js';
import { AiPolicyV1 } from '../../../src/policy/ai_policy.js';
import { FirewallRulesV1 } from '../../../src/policy/firewall_rules.js';

// AI-01 §12.5 `policy/ai_policy@v1.yaml` 과 같은 값. per_task는 D8에 따라 35키 전부(명시 안 된 과업 = 기본값과 같은 값).
const perTask35 = (): Record<string, number> => ({
  ...Object.fromEntries(JudgeTaskId.options.map((t) => [t, 30])), // J = judge
  ...Object.fromEntries(GenerateTaskId.options.map((t) => [t, 7])), // G = generate
  'AI-G06': 1,
  'AI-G07': 0,
  'AI-G09': 0,
  ...Object.fromEntries(SystemTaskId.options.map((t) => [t, 0])), // SYS-* = 0
});
const aiPolicy = (): Record<string, unknown> => ({
  version: 'ai_policy@v1',
  budget: { monthly_krw: 30000, degrade_day: 20, warn: 0.8, stop: 1.0, per_call_usd_cap: 0.5 },
  jev: {
    rps: 15,
    burst: 30,
    concurrency: 20,
    monthly_krw_cap: 3000,
    timeout_ms: { interactive: 3000, background: 10000 },
  },
  bulk: { calls: 50, krw: 1000, quota_pct: 20 },
  quota_windows: {
    'claude-cli': { five_hour_calls: 30, five_hour_tokens: null, weekly_calls: 300 },
    'codex-cli': { five_hour_calls: 30, five_hour_tokens: null, weekly_calls: 300 },
    'gemini-cli': { five_hour_calls: 60, five_hour_tokens: null, weekly_calls: 600 },
    'gcli-*': { five_hour_calls: 30, five_hour_tokens: null, weekly_calls: 300 },
  },
  batch_window: { idle_min: 10, require_ac: true },
  yield_interactive_cli: { enabled: true, resume_after_min: 10 },
  cli_concurrency: 2,
  cli_per_minute: 20,
  rate_limits: {
    'anthropic-api': { rpm: 50, concurrency: 4 },
    'openai-api': { rpm: 60, concurrency: 4 },
    'gemini-api': { rpm: 30, concurrency: 2 },
    ollama: { rpm: 120, concurrency: 1 },
  },
  aimd: { decrease: 0.5, recover_per_min: 0.1 },
  breaker: { window_s: 60, failures: 5, error_rate: 0.5, min_calls: 4, open_s: 60, open_max_s: 600 },
  mode: { upgrade_hold_s: 30 },
  cache_ttl_days: { judge: 30, generate: 7, max: 90, per_task: perTask35() },
  fx_krw_per_usd: 1400,
  pricing: {
    as_of: null,
    models: [{ provider: 'jev', match: '.*', in: 0.042, out: 0.0, cache_read: 0.0 }],
    unknown_model: { in: 15.0, out: 75.0, cache_read: 1.5 },
  },
  cli_env: { pass_proxy: false },
  deadlines_ms: { interactive_max: 3000, conversational_max: 60000, background_max: 300000 },
  work_order: { approval_ttl_days: 7, approved_ttl_days: 30 },
  confirm_cards: { per_day_max: 3 },
  calibration: { gold_confirmed_min: 20, gold_confirmed_min_with_cross_review: 10, recalibrate_suggest_at: 30 },
});

type Json = Record<string, unknown>;
const fresh = (): Json => JSON.parse(JSON.stringify(aiPolicy())) as Json;

describe('ai_policy.ts (frozen pending — IF-01 §13.4 전사)', () => {
  it('UT-CON-154 AiPolicyV1: AI-01 §12.5 값 + per_task 35키 통과, per_task 6키(AI-01 원문) 거부(D8 고정 단언), quota_windows gcli-* 키 통과, rate_limits foo 키 거부 [FR-AI-007][CR-43]', () => {
    const base = aiPolicy();
    const ok = AiPolicyV1.safeParse(base);
    expect(ok.success, JSON.stringify(ok.error?.issues.slice(0, 3))).toBe(true);

    // D8: per_task = TaskId ∪ SystemTaskId 35키 전수 record
    expect(Object.keys(perTask35())).toHaveLength(35);
    expect(JudgeTaskId.options.length + GenerateTaskId.options.length + SystemTaskId.options.length).toBe(35);
    const sixKeys = fresh();
    (sixKeys.cache_ttl_days as Json).per_task = {
      'AI-G07': 0,
      'AI-G09': 0,
      'AI-G06': 1,
      'SYS-CANARY': 0,
      'SYS-SMOKE': 0,
      'SYS-FWCLS': 0,
    };
    const sixResult = AiPolicyV1.safeParse(sixKeys);
    expect(sixResult.success).toBe(false); // AI-01 §12.5 원문 6키는 거부된다(T-00-15는 35키를 적어야 한다)
    expect(sixResult.error?.issues.length).toBeGreaterThanOrEqual(29); // 빠진 29개 과업 각각
    const missingOne = fresh();
    const per = { ...perTask35() };
    delete per['AI-J19'];
    (missingOne.cache_ttl_days as Json).per_task = per;
    expect(AiPolicyV1.safeParse(missingOne).success).toBe(false);
    const unknownTask = fresh();
    (unknownTask.cache_ttl_days as Json).per_task = { ...perTask35(), 'AI-G99': 1 };
    expect(AiPolicyV1.safeParse(unknownTask).success).toBe(false);
    const negative = fresh();
    (negative.cache_ttl_days as Json).per_task = { ...perTask35(), 'AI-G07': -1 };
    expect(AiPolicyV1.safeParse(negative).success).toBe(false);

    // quota_windows 키: claude-cli·codex-cli·gemini-cli·gcli-* (전수 아님)
    const onlyGcli = fresh();
    onlyGcli.quota_windows = { 'gcli-*': { five_hour_calls: 30, five_hour_tokens: null, weekly_calls: 300 } };
    expect(AiPolicyV1.safeParse(onlyGcli).success).toBe(true);
    const badWindow = fresh();
    (badWindow.quota_windows as Json)['gcli-mytool'] = { five_hour_calls: 1, five_hour_tokens: null, weekly_calls: 1 };
    expect(AiPolicyV1.safeParse(badWindow).success).toBe(false);
    const badWindow2 = fresh();
    (badWindow2.quota_windows as Json).foo = { five_hour_calls: 1, five_hour_tokens: null, weekly_calls: 1 };
    expect(AiPolicyV1.safeParse(badWindow2).success).toBe(false);

    // rate_limits 키 = ProviderId(정규식 키, 비전수)
    const fooRate = fresh();
    (fooRate.rate_limits as Json).foo = { rpm: 1, concurrency: 1 };
    expect(AiPolicyV1.safeParse(fooRate).success).toBe(false);
    const gcliRate = fresh();
    (gcliRate.rate_limits as Json)['gcli-mytool'] = { rpm: 10, concurrency: 1 };
    expect(AiPolicyV1.safeParse(gcliRate).success).toBe(true);
    const emptyRate = fresh();
    emptyRate.rate_limits = {};
    expect(AiPolicyV1.safeParse(emptyRate).success).toBe(true); // 정규식 키 record는 비전수

    // 그 밖의 경계
    expect(AiPolicyV1.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(AiPolicyV1.safeParse({ ...base, version: 'ai_policy@v2' }).success).toBe(false);
    expect(AiPolicyV1.safeParse({ ...base, fx_krw_per_usd: 0 }).success).toBe(false);
    expect(AiPolicyV1.safeParse({ ...base, cli_concurrency: 0 }).success).toBe(false);
    expect(AiPolicyV1.safeParse({ ...base, budget: { ...(base.budget as Json), degrade_day: 32 } }).success).toBe(
      false,
    );
    expect(AiPolicyV1.safeParse({ ...base, breaker: { ...(base.breaker as Json), extra: 1 } }).success).toBe(false);
    expect(AiPolicyV1.safeParse({ ...base, pricing: { ...(base.pricing as Json), as_of: '2026-10-01' } }).success).toBe(
      true,
    );
    expect(AiPolicyV1.safeParse({ ...base, pricing: { ...(base.pricing as Json), as_of: '2026/10/01' } }).success).toBe(
      false,
    );
  });
});

// AI-01 §10.3 `policy/firewall_rules@v1.yaml` 27규칙(YAML → 객체).
const pat = (id: string, name: string, pattern: string, extra: Json = {}): Json => ({
  id,
  name,
  pattern,
  action: 'mask',
  ...extra,
});
const firewallRules = (): Json => ({
  version: 'firewall_rules@v1',
  mask_token: '⟨SECRET_{n}⟩',
  allow_literals: ['example.com', 'example.org', 'example.net', 'test.invalid', 'localhost', 'sk-ant-xxxx', 'sk-xxxx'],
  rules: [
    pat('FW-SEC-001', 'anthropic_key', 'sk-ant-[A-Za-z0-9_-]{20,}'),
    pat('FW-SEC-002', 'openai_key', 'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}'),
    pat('FW-SEC-003', 'google_api_key', 'AIza[0-9A-Za-z_-]{35}'),
    pat('FW-SEC-004', 'github_token', '(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})'),
    pat('FW-SEC-005', 'aws_access_key', '\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b'),
    pat('FW-SEC-006', 'aws_secret', '(?i)aws_secret_access_key\\s*[:=]\\s*[\'"]?([A-Za-z0-9/+=]{40})', { group: 1 }),
    pat('FW-SEC-007', 'slack_token', 'xox[abprs]-[A-Za-z0-9-]{10,}'),
    pat('FW-SEC-008', 'jwt', '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'),
    pat('FW-SEC-009', 'pem_private_key', '-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----', {
      action: 'block',
      c0_action: 'mask',
      span: 'until_end_marker',
    }),
    pat(
      'FW-SEC-010',
      'secret_assignment',
      '(?i)\\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\\b\\s*[:=]\\s*[\'"]?([^\\s\'"]{8,})',
      { group: 1 },
    ),
    pat('FW-SEC-011', 'url_credentials', '\\b[a-z][a-z0-9+.-]*://([^\\s:/@]+:[^\\s@/]+)@', { group: 1 }),
    pat('FW-SEC-012', 'auth_header', '(?i)\\bauthorization\\s*:\\s*(?:bearer|basic)\\s+([A-Za-z0-9._~+/=-]{16,})', {
      group: 1,
    }),
    pat('FW-SEC-013', 'npm_token', '\\bnpm_[A-Za-z0-9]{36}\\b'),
    pat('FW-SEC-014', 'payment_key', '\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}'),
    pat('FW-SEC-015', 'azure_conn', '(?i)AccountKey=([A-Za-z0-9+/=]{40,})', { group: 1 }),
    pat('FW-PII-001', 'kr_rrn', '\\b\\d{6}-?[1-4]\\d{6}\\b'),
    pat('FW-PII-002', 'kr_phone', '\\b01[016789]-?\\d{3,4}-?\\d{4}\\b'),
    pat('FW-PII-003', 'email', '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b', {
      except_allow_literals: true,
    }),
    pat('FW-PII-004', 'card_number', '\\b(?:\\d[ -]?){13,19}\\b', { validate: 'luhn' }),
    pat('FW-PII-005', 'kr_biz_reg', '\\b\\d{3}-\\d{2}-\\d{5}\\b'),
    pat(
      'FW-NET-001',
      'private_ipv4',
      '\\b(?:10\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b',
    ),
    pat(
      'FW-NET-002',
      'internal_host',
      '(?i)\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:corp|internal|intranet|lan|local|localdomain)\\b',
    ),
    pat('FW-NET-003', 'ipv6_ula', '(?i)\\bf[cd][0-9a-f]{2}:[0-9a-f:]{2,}\\b'),
    pat('FW-NET-004', 'unc_path', '\\\\\\\\[A-Za-z0-9._-]+\\\\[^\\s]+'),
    { id: 'FW-USR-000', name: 'user_patterns', source: 'ai_firewall_pattern', action: 'force_local' },
    {
      id: 'FW-LCL-001',
      name: 'local_classifier',
      source: 'SYS-FWCLS',
      when: 'confidential && confidence >= 0.6',
      action: 'force_local',
    },
    { id: 'FW-LOC-001', name: 'local_only_flag', source: 'request.local_only', action: 'force_local' },
  ],
  injection_patterns: [
    '(?i)ignore\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|above)\\s+(?:instructions|prompts|rules)',
    '(?i)\\byou\\s+are\\s+now\\b',
    '(?i)\\b(?:system|assistant)\\s*:\\s',
    '(?i)</?(?:system|assistant|user|instructions?)>',
    '(?i)reveal\\s+(?:your|the)\\s+(?:system\\s+)?prompt',
    '(?i)do\\s+not\\s+(?:tell|inform)\\s+the\\s+user',
    '이전\\s*(?:지시|명령|프롬프트|규칙)\\S*\\s*(?:무시|잊)',
    '너는\\s*이제',
    '(?:만점|최고\\s*점수|정답\\s*처리)\\S*\\s*(?:줘|주세요|하라|해라)',
    '(?i)(?:curl|wget)\\s+https?://',
  ],
});
const fwFresh = (): Json => JSON.parse(JSON.stringify(firewallRules())) as Json;
const rulesOf = (v: Json): Json[] => v.rules as Json[];

describe('policy/firewall_rules.ts', () => {
  it('UT-CON-155 FirewallRulesV1: AI-01 §10.3 27규칙과 같은 객체 통과, 규칙 id 중복 거부, action drop 거부, data_class_defaults 생략 통과 [FR-AI-019][NFR-DATA-010]', () => {
    const base = firewallRules();
    expect(rulesOf(base)).toHaveLength(27);
    const ok = FirewallRulesV1.safeParse(base);
    expect(ok.success, JSON.stringify(ok.error?.issues.slice(0, 3))).toBe(true);
    expect(base.data_class_defaults).toBeUndefined(); // 생략 통과(선택)

    // data_class_defaults·규칙 class(선택)
    const withDefaults = fwFresh();
    withDefaults.data_class_defaults = { learner_note: 'C1', imported_chunk: 'C2', secret_hit: 'C3' };
    expect(FirewallRulesV1.safeParse(withDefaults).success).toBe(true);
    const badDefaults = fwFresh();
    badDefaults.data_class_defaults = { learner_note: 'C9' };
    expect(FirewallRulesV1.safeParse(badDefaults).success).toBe(false);
    const badDefaultKey = fwFresh();
    badDefaultKey.data_class_defaults = { 'Learner Note': 'C1' };
    expect(FirewallRulesV1.safeParse(badDefaultKey).success).toBe(false);
    const withClass = fwFresh();
    (rulesOf(withClass)[0] as Json).class = 'C3';
    (rulesOf(withClass)[24] as Json).class = 'C3';
    expect(FirewallRulesV1.safeParse(withClass).success).toBe(true);

    // 규칙 id 중복
    const dup = fwFresh();
    (rulesOf(dup)[1] as Json).id = 'FW-SEC-001';
    expect(FirewallRulesV1.safeParse(dup).success).toBe(false);
    // action
    const drop = fwFresh();
    (rulesOf(drop)[0] as Json).action = 'drop';
    expect(FirewallRulesV1.safeParse(drop).success).toBe(false);
    const sourceMask = fwFresh();
    (rulesOf(sourceMask)[24] as Json).action = 'mask'; // source 규칙은 force_local만
    expect(FirewallRulesV1.safeParse(sourceMask).success).toBe(false);
    // id·name·pattern 형식
    const badId = fwFresh();
    (rulesOf(badId)[0] as Json).id = 'FW-XXX-001';
    expect(FirewallRulesV1.safeParse(badId).success).toBe(false);
    const badName = fwFresh();
    (rulesOf(badName)[0] as Json).name = 'Anthropic Key';
    expect(FirewallRulesV1.safeParse(badName).success).toBe(false);
    const emptyPattern = fwFresh();
    (rulesOf(emptyPattern)[0] as Json).pattern = '';
    expect(FirewallRulesV1.safeParse(emptyPattern).success).toBe(false);
    const badGroup = fwFresh();
    (rulesOf(badGroup)[5] as Json).group = 10;
    expect(FirewallRulesV1.safeParse(badGroup).success).toBe(false);
    const badSource = fwFresh();
    (rulesOf(badSource)[25] as Json).source = 'user.input';
    expect(FirewallRulesV1.safeParse(badSource).success).toBe(false);
    // 규칙 미지 키·최상위 미지 키·마스크 토큰·빈 규칙
    const extraKey = fwFresh();
    (rulesOf(extraKey)[0] as Json).extra = 1;
    expect(FirewallRulesV1.safeParse(extraKey).success).toBe(false);
    expect(FirewallRulesV1.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(FirewallRulesV1.safeParse({ ...base, mask_token: '<SECRET_{n}>' }).success).toBe(false);
    expect(FirewallRulesV1.safeParse({ ...base, rules: [] }).success).toBe(false);
    expect(FirewallRulesV1.safeParse({ ...base, version: 'firewall_rules@v2' }).success).toBe(false);
    expect(FirewallRulesV1.safeParse({ ...base, injection_patterns: Array(51).fill('(?i)x') }).success).toBe(false);
    // 정규식 컴파일 검사는 하지 않는다(RE2 부분집합·(?i)는 소비 서비스가 해석)
    const uncompilable = fwFresh();
    (rulesOf(uncompilable)[0] as Json).pattern = '(?<name>[';
    expect(FirewallRulesV1.safeParse(uncompilable).success).toBe(true);
  });
});
