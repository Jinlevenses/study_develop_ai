// UT-PACKC-050·059 — 저장소 policy/ 12종 @v1 실파일(E0-9)을 loadPolicy로 읽어 소유·값을 고정한다(읽기 전용).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenerateTaskId, JudgeTaskId, SystemTaskId } from '@fathom/contracts/ai/tasks';
import { FormatId } from '@fathom/contracts/common/domain';
import { AiPolicyV1 } from '@fathom/contracts/policy/ai_policy';
import { FirewallRulesV1 } from '@fathom/contracts/policy/firewall_rules';
import { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import { LdiParamsV1 } from '@fathom/contracts/policy/ldi_params';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import { SearchParamsV1 } from '@fathom/contracts/policy/search_params';
import { loadPolicy } from '@fathom/shared-kernel/policy/policy';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { LOCK_FILE, POLICY_OWNERS, POLICY_SCHEMAS, type PolicyName } from '../../../src/policy/lock-cli.js';

const REPO_POLICY = fileURLToPath(new URL('../../../../../policy/', import.meta.url));

function load<S extends z.ZodType>(name: PolicyName, schema: S): z.output<S> {
  const r = loadPolicy(name, 1, { policyDir: REPO_POLICY, schema });
  if (!r.ok) {
    throw new Error(`${r.error.ref} ${r.error.reason} ${r.error.detail}`);
  }
  return r.value.value;
}

const NAMES: readonly PolicyName[] = [
  'method_policy',
  'composer_policy',
  'mastery_rules',
  'ldi_params',
  'gaming_params',
  'cbm_params',
  'fsrs_params',
  'gate_thresholds',
  'search_params',
  'ai_policy',
  'firewall_rules',
  'ops_policy',
];

describe('정책 12종 @v1 실파일', () => {
  it('UT-PACKC-050 12종 각각 loadPolicy가 ok이고 owner가 소유 표와 같으며 lock 키는 12 ref 정확히다 [FR-CUR-017][QAS-19]', () => {
    expect([...NAMES].sort()).toEqual(Object.keys(POLICY_OWNERS).sort());
    for (const name of NAMES) {
      const r = loadPolicy(name, 1, { policyDir: REPO_POLICY, schema: POLICY_SCHEMAS[name] });
      expect(r.ok, name).toBe(true);
      if (r.ok) {
        expect(r.value.ref).toBe(`${name}@v1`);
        expect(r.value.owner).toBe(POLICY_OWNERS[name]);
      }
    }
    const lockJson: unknown = JSON.parse(readFileSync(join(REPO_POLICY, LOCK_FILE), 'utf8'));
    expect(typeof lockJson === 'object' && lockJson !== null).toBe(true);
    if (typeof lockJson === 'object' && lockJson !== null) {
      expect(Object.keys(lockJson).sort()).toEqual(NAMES.map((n) => `${n}@v1`).sort());
    }
  });

  it('UT-PACKC-059 SP-6·CR-18~22·Router 25칸·FSRS w·LDI 잠정·AI breaker/TTL·방화벽 27규칙·strip_chars 값을 고정한다 [FR-PRG-009][FR-PRG-013][FR-STD-007][FR-AI-008][CR-18][CR-19][CR-20][CR-21][CR-22]', () => {
    // mastery_rules — SP-6 F0·F1·F3·F4, θ 수축(CR-22), CR-18~21
    const m = load('mastery_rules', MasteryRulesV1);
    expect(m.elo.guess_correction).toBe(true);
    expect(m.promotion.empty_level).toBe('skip');
    expect(m.d4.floor_mode).toBe('min_with_possible');
    expect(m.elo.unqualified_ceiling).toBe(0);
    expect(m.theta_shrink).toEqual({ theta_prior: -0.5, theta_shrink_n0: 10, theta_display_min_events: 30 });
    expect(m.promotion.required_mastered).toEqual({ all_if_n_le: 3, ratio: 0.85, allow_misses: 1 });
    expect(m.assessment.accuracy_min_correct).toEqual({ '1': 10, '2': 10, '3': 10, '4': 11 });
    expect(m.ai_profiles.JUDGE_ONLY.rubric_engine.sp1_fail).toBe('S_provisional');
    expect(m.sparse.depth_scope).toBe('track');
    expect(m.d4.possible_scope).toBe('level_le_k');
    expect(m.epsilon).toBe(1e-9);

    // method_policy — formats 키 = FormatId 33, router 25칸 형식 ≥ 2, 금기(exclude_formats) 형식 미포함
    const mp = load('method_policy', MethodPolicyV1);
    expect(Object.keys(mp.formats).sort()).toEqual([...FormatId.options].sort());
    expect(Object.keys(mp.formats)).toHaveLength(33);
    const rows = ['D', 'C', 'P', 'S', 'M'] as const;
    const levels = ['1', '2', '3', '4', '5'] as const;
    let cells = 0;
    for (const row of rows) {
      for (const lv of levels) {
        const cell = mp.router_25[row][lv];
        expect(cell.formats.length, `${row}${lv}`).toBeGreaterThanOrEqual(2);
        cells += 1;
      }
    }
    expect(cells).toBe(25);
    const excluding = mp.taboo.filter((t) => t.effect.kind === 'exclude_formats');
    expect(excluding.map((t) => t.id)).toEqual(['TB-03', 'TB-04']);
    for (const t of excluding) {
      if (t.effect.kind !== 'exclude_formats') {
        continue;
      }
      const banned = new Set<string>(t.effect.formats);
      const targetRows = t.knowledge_types.length === 0 ? rows : t.knowledge_types;
      for (const row of targetRows) {
        for (const lv of t.levels) {
          const cell = mp.router_25[row][levels[lv - 1] ?? '1'];
          expect(
            cell.formats.filter((f) => banned.has(f)),
            `${t.id} ${row}${lv}`,
          ).toEqual([]);
        }
      }
    }

    // fsrs_params — ts-fsrs 5.4.2 default_w 21개(SP-3)
    expect(load('fsrs_params', FsrsParamsV1).w).toEqual([
      0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
      1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
    ]);

    // ldi_params·mastery_rules — 잠정(provisional) 표시
    expect(load('ldi_params', LdiParamsV1).provisional).toBe(true);
    for (const name of ['mastery_rules', 'ldi_params']) {
      const third = readFileSync(join(REPO_POLICY, `${name}@v1.yaml`), 'utf8').split('\n')[2];
      expect(third, name).toMatch(/^# provisional: /);
    }

    // ai_policy — breaker(FR-AI-008), per_task 35키(T-00-09 D8)
    const ai = load('ai_policy', AiPolicyV1);
    expect(ai.breaker).toEqual({
      window_s: 60,
      failures: 5,
      error_rate: 0.5,
      min_calls: 4,
      open_s: 60,
      open_max_s: 600,
    });
    const taskKeys = [...JudgeTaskId.options, ...GenerateTaskId.options, ...SystemTaskId.options];
    expect(Object.keys(ai.cache_ttl_days.per_task).sort()).toEqual([...taskKeys].sort());
    expect(Object.keys(ai.cache_ttl_days.per_task)).toHaveLength(35);
    expect(ai.cache_ttl_days.per_task).toMatchObject({
      'AI-J01': 30,
      'AI-J19': 30,
      'AI-G01': 7,
      'AI-G06': 1,
      'AI-G07': 0,
      'AI-G09': 0,
      'AI-G13': 7,
      'SYS-CANARY': 0,
      'SYS-SMOKE': 0,
      'SYS-FWCLS': 0,
    });

    // firewall_rules — AI-01 §10.3 27규칙, 작은따옴표 '' 이스케이프가 원문 정규식으로 파싱됨
    const fw = load('firewall_rules', FirewallRulesV1);
    expect(fw.rules).toHaveLength(27);
    expect(fw.mask_token).toBe('⟨SECRET_{n}⟩');
    expect(fw.injection_patterns).toHaveLength(10);
    const pattern = (id: string): string | undefined => {
      const rule = fw.rules.find((r) => r.id === id);
      return rule !== undefined && 'pattern' in rule ? rule.pattern : undefined;
    };
    expect(pattern('FW-SEC-006')).toBe(String.raw`(?i)aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})`);
    expect(pattern('FW-SEC-010')).toBe(
      String.raw`(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*['"]?([^\s'"]{8,})`,
    );
    expect(pattern('FW-NET-004')).toBe(String.raw`\\\\[A-Za-z0-9._-]+\\[^\s]+`);

    // search_params — strip_chars 34자 정확히, 식별자 문자 . - _ + # / 미포함 [Brief 결정]
    const sp = load('search_params', SearchParamsV1);
    expect([...sp.strip_chars]).toEqual([
      '"',
      "'",
      '`',
      '“',
      '”',
      '‘',
      '’',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '<',
      '>',
      '*',
      '^',
      ':',
      ',',
      ';',
      '!',
      '?',
      '「',
      '」',
      '『',
      '』',
      '《',
      '》',
      '〈',
      '〉',
      '、',
      '。',
      '…',
      '·',
    ]);
    for (const keep of ['.', '-', '_', '+', '#', '/']) {
      expect(sp.strip_chars.includes(keep), keep).toBe(false);
    }
  });
});
