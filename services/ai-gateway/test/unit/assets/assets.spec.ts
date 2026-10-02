import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GenerateTaskId, JudgeTaskId, TaskRegistryEntry } from '@fathom/contracts/ai/tasks';
import { parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import { describe, expect, it } from 'vitest';

const ASSETS = fileURLToPath(new URL('../../../assets/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const asset = (rel: string): string => readFileSync(`${ASSETS}${rel}`, 'utf8');

/** AI-01 문서의 코드 블록 중 첫 줄이 `prefix`로 시작하는 것(여는 펜스 다음 줄 ~ 닫는 펜스 직전 줄 + LF). */
function aiDocBlock(lang: string, prefix: string): string {
  const lines = readFileSync(`${REPO_ROOT}docs/02-design/05-ai-design.md`, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === `\`\`\`${lang}` && lines[i + 1]?.startsWith(prefix) === true) {
      let end = i + 1;
      while (lines[end] !== '```') {
        end += 1;
      }
      return `${lines.slice(i + 1, end).join('\n')}\n`;
    }
  }
  throw new Error(`AI-01 block not found: ${prefix}`);
}

function parsedTasks(): Record<string, Record<string, unknown>> {
  const parsed = parseYamlStrict(asset('tasks.yaml'));
  if (!parsed.ok) {
    throw new Error(`tasks.yaml rejected: ${parsed.error.detail}`);
  }
  return parsed.value as Record<string, Record<string, unknown>>;
}
const entries = (): [string, Record<string, unknown>][] =>
  Object.entries(parsedTasks()).filter(([k]) => k !== '_defaults');

// AI-01 §6.2 기대표(테스트 안 리터럴 32행): kind·lane·chain·tier·data_class_max·family_constraint·deadline_ms·requires_work_order
type Row = [
  string,
  'judge' | 'generate',
  'interactive' | 'conversational' | 'background',
  'low' | 'mid' | 'high',
  'C0' | 'C1' | 'C2',
  'none' | 'different_from_generator',
  number,
  boolean,
];
const J = 'judge';
const G = 'generate';
const EXPECTED: Row[] = [
  ['AI-J01', J, 'interactive', 'low', 'C1', 'none', 3000, false],
  ['AI-J02', J, 'interactive', 'low', 'C1', 'none', 3000, false],
  ['AI-J03', J, 'interactive', 'mid', 'C1', 'none', 3000, false],
  ['AI-J04', J, 'interactive', 'high', 'C1', 'none', 3000, false],
  ['AI-J05', J, 'interactive', 'mid', 'C1', 'none', 3000, false],
  ['AI-J06', J, 'interactive', 'low', 'C1', 'none', 3000, false],
  ['AI-J07', J, 'background', 'mid', 'C0', 'different_from_generator', 120000, true],
  ['AI-J08', J, 'background', 'mid', 'C0', 'different_from_generator', 120000, true],
  ['AI-J09', J, 'background', 'low', 'C0', 'none', 120000, true],
  ['AI-J10', J, 'background', 'low', 'C0', 'none', 120000, true],
  ['AI-J11', J, 'background', 'low', 'C0', 'none', 120000, true],
  ['AI-J12', J, 'background', 'low', 'C2', 'none', 120000, true],
  ['AI-J13', J, 'background', 'low', 'C2', 'none', 120000, false],
  ['AI-J14', J, 'background', 'mid', 'C2', 'different_from_generator', 120000, true],
  ['AI-J15', J, 'background', 'mid', 'C2', 'none', 120000, true],
  ['AI-J16', J, 'background', 'low', 'C2', 'none', 120000, true],
  ['AI-J17', J, 'interactive', 'low', 'C1', 'none', 3000, false],
  ['AI-J18', J, 'interactive', 'mid', 'C1', 'none', 3000, false],
  ['AI-J19', J, 'background', 'high', 'C1', 'none', 120000, true],
  ['AI-G01', G, 'background', 'mid', 'C1', 'none', 180000, true],
  ['AI-G02', G, 'background', 'high', 'C1', 'none', 240000, true],
  ['AI-G03', G, 'background', 'mid', 'C0', 'none', 180000, true],
  ['AI-G04', G, 'background', 'low', 'C0', 'none', 120000, true],
  ['AI-G05', G, 'background', 'mid', 'C2', 'none', 240000, true],
  ['AI-G06', G, 'conversational', 'low', 'C1', 'none', 60000, false],
  ['AI-G07', G, 'conversational', 'low', 'C1', 'none', 60000, false],
  ['AI-G08', G, 'conversational', 'mid', 'C0', 'none', 60000, false],
  ['AI-G09', G, 'background', 'low', 'C0', 'none', 120000, true],
  ['AI-G10', G, 'background', 'low', 'C2', 'none', 60000, false],
  ['AI-G11', G, 'background', 'mid', 'C0', 'different_from_generator', 120000, true],
  ['AI-G12', G, 'background', 'mid', 'C0', 'none', 120000, true],
  ['AI-G13', G, 'background', 'high', 'C0', 'none', 180000, true],
];

// AI-01 §6.2 `_defaults` 앵커 5개(원문 그대로)
const LJI = ['anthropic-api', 'openai-api', 'gemini-api', 'ollama'];
const LJB = ['claude-cli', 'codex-cli', 'anthropic-api', 'openai-api', 'gemini-api', 'gemini-cli', 'ollama'];
const GAPI = ['anthropic-api', 'openai-api', 'gemini-api', 'claude-cli', 'codex-cli', 'gemini-cli', 'ollama'];
const GCLI = ['claude-cli', 'anthropic-api', 'openai-api', 'gemini-api', 'codex-cli', 'gemini-cli', 'ollama'];
const SAPI = ['anthropic-api', 'openai-api', 'gemini-api', 'ollama'];

describe('ai-gateway 자산', () => {
  it('UT-AI-090 tasks.yaml: 별칭 토큰 0 · parseYamlStrict ok · 최상위 키 = _defaults + TaskId 32개 [FR-AI-004]', () => {
    // Arrange
    const text = asset('tasks.yaml');
    // Act
    const keys = Object.keys(parsedTasks()).filter((k) => k !== '_defaults');
    // Assert
    expect(/[&*]/.test(text)).toBe(false);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
    expect(Object.keys(parsedTasks())).toContain('_defaults');
    expect(keys.sort()).toEqual([...JudgeTaskId.options, ...GenerateTaskId.options].sort());
    expect(keys).toHaveLength(32);
  });

  it('UT-AI-091 32항목 TaskRegistryEntry 통과 · prompt.id = 키 · channel = active [FR-AI-004]', () => {
    for (const [key, value] of entries()) {
      // Act
      const parsed = TaskRegistryEntry.safeParse(value);
      // Assert
      expect(parsed.success, key).toBe(true);
      expect(parsed.success && parsed.data.prompt, key).toEqual({ id: key, channel: 'active' });
    }
  });

  it('UT-AI-092 항목 값 = AI-01 §6.2 기대표 [FR-AI-004]', () => {
    const byKey = new Map(entries());
    expect(EXPECTED).toHaveLength(32);
    for (const [id, kind, lane, tier, dataClass, family, deadline, workOrder] of EXPECTED) {
      // Act
      const entry = TaskRegistryEntry.parse(byKey.get(id));
      // Assert
      expect(entry, id).toMatchObject({
        kind,
        lane,
        tier,
        data_class_max: dataClass,
        family_constraint: family,
        deadline_ms: deadline,
        requires_work_order: workOrder,
        chain: kind === 'judge' ? ['jev', 'llm-judge'] : ['llm'],
      });
    }
    const different = EXPECTED.filter((r) => r[5] === 'different_from_generator').map((r) => r[0]);
    expect(different).toEqual(['AI-J07', 'AI-J08', 'AI-J14', 'AI-G11']);
    const noWorkOrder = EXPECTED.filter((r) => !r[7]).map((r) => r[0]);
    expect(noWorkOrder).toEqual([
      'AI-J01',
      'AI-J02',
      'AI-J03',
      'AI-J04',
      'AI-J05',
      'AI-J06',
      'AI-J13',
      'AI-J17',
      'AI-J18',
      'AI-G06',
      'AI-G07',
      'AI-G08',
      'AI-G10',
    ]);
  });

  it('UT-AI-093 앵커 전개 동치 · deny 규칙 [FR-AI-004]', () => {
    // Arrange
    const defaults = parsedTasks()._defaults;
    const prefer = (id: string): unknown => TaskRegistryEntry.parse(parsedTasks()[id]).prefer;
    // Assert: _defaults 5목록
    expect(defaults).toEqual({
      lj_interactive: LJI,
      lj_background: LJB,
      gen_api_first: GAPI,
      gen_cli_first: GCLI,
      stream_api: SAPI,
    });
    // 원문이 별칭을 쓴 항목 = 해당 목록
    for (const id of ['AI-J01', 'AI-J02', 'AI-J03', 'AI-J04', 'AI-J05', 'AI-J06', 'AI-J17', 'AI-J18']) {
      expect(prefer(id), id).toEqual(LJI);
    }
    for (const id of ['AI-J09', 'AI-J10', 'AI-J11', 'AI-J12', 'AI-J13', 'AI-J14', 'AI-J15', 'AI-J16']) {
      expect(prefer(id), id).toEqual(LJB);
    }
    for (const id of ['AI-G04', 'AI-G10', 'AI-G12']) {
      expect(prefer(id), id).toEqual(GAPI);
    }
    expect(prefer('AI-G01')).toEqual(GCLI);
    for (const id of ['AI-G06', 'AI-G07', 'AI-G08']) {
      expect(prefer(id), id).toEqual(SAPI);
    }
    // 인라인 항목 = 원문 목록
    expect(prefer('AI-J07')).toEqual([
      'codex-cli',
      'openai-api',
      'gemini-cli',
      'gemini-api',
      'claude-cli',
      'anthropic-api',
      'ollama',
    ]);
    expect(prefer('AI-J19')).toEqual([
      'anthropic-api',
      'openai-api',
      'claude-cli',
      'codex-cli',
      'gemini-api',
      'gemini-cli',
    ]);
    expect(prefer('AI-G02')).toEqual(['claude-cli', 'anthropic-api', 'openai-api', 'gemini-api', 'codex-cli']);
    expect(prefer('AI-G09')).toEqual([
      'ollama',
      'anthropic-api',
      'openai-api',
      'gemini-api',
      'claude-cli',
      'codex-cli',
      'gemini-cli',
    ]);
    // deny = G01·G02·G13만
    const denies = entries()
      .map(([id, v]) => [id, TaskRegistryEntry.parse(v).deny] as const)
      .filter(([, deny]) => deny !== undefined);
    expect(denies).toEqual([
      ['AI-G01', { ollama: ['stakes:S2'] }],
      ['AI-G02', { ollama: ['always'] }],
      ['AI-G13', { ollama: ['always'] }],
    ]);
  });

  it('UT-AI-094 판단 19 / 생성 13 구조 [FR-AI-004]', () => {
    const parsed = entries().map(([id, v]) => [id, TaskRegistryEntry.parse(v)] as const);
    const judges = parsed.filter(([, e]) => e.kind === 'judge');
    const generates = parsed.filter(([, e]) => e.kind === 'generate');
    expect(judges).toHaveLength(19);
    expect(generates).toHaveLength(13);
    for (const [id, e] of judges) {
      expect(e.chain, id).toEqual(['jev', 'llm-judge']);
      expect(e.question_types?.length ?? 0, id).toBeGreaterThanOrEqual(1);
      expect(e.max_questions_per_request, id).toBe(15);
      expect(e.schema, id).toBeUndefined();
    }
    for (const [id, e] of generates) {
      expect(e.chain, id).toEqual(['llm']);
      expect(e.question_types, id).toBeUndefined();
      if (id !== 'AI-G10') {
        expect(e.schema, id).toBeDefined();
      }
    }
    expect(generates.find(([id]) => id === 'AI-G10')?.[1].schema).toBeUndefined();
  });

  it('UT-AI-095 model-defaults.yaml = AI-01 §3.4 블록 바이트 동일 [FR-AI-004]', () => {
    // Arrange
    const text = asset('model-defaults.yaml');
    const parsed = parseYamlStrict(text);
    // Assert
    expect(text).toBe(aiDocBlock('yaml', '# file: services/ai-gateway/assets/model-defaults.yaml'));
    expect(parsed.ok).toBe(true);
    const doc = (parsed.ok ? parsed.value : {}) as Record<string, Record<string, unknown>>;
    expect(Object.keys(doc)).toEqual([
      'version',
      'jev',
      'anthropic-api',
      'openai-api',
      'gemini-api',
      'ollama',
      'claude-cli',
      'codex-cli',
      'gemini-cli',
    ]);
    expect(doc.version).toBe(1);
    expect(doc['codex-cli']).toEqual({ low: null, mid: null, high: null });
    expect(doc['gemini-cli']).toEqual({ low: null, mid: null, high: null });
  });

  it('UT-AI-096 empty-mcp.json · prompts.lock.json 바이트 [NFR-SEC-020]', () => {
    // Arrange: AI-01 §4.2 `{"mcpServers":{}}` — biome 포매터(lint)가 JSON 공백을 정규화하므로 의미 동치 + 포매터 안정 바이트로 단언한다(deviation 기록).
    const mcp = asset('empty-mcp.json');
    // Assert
    expect(JSON.parse(mcp)).toEqual({ mcpServers: {} });
    expect(mcp).toBe('{ "mcpServers": {} }\n');
    expect(asset('prompts.lock.json')).toBe('{}\n');
  });

  it('UT-AI-097 codex-home/config.toml = AI-01 §4.2 toml 블록, MCP·hooks·profiles 없음 [NFR-SEC-020]', () => {
    // Arrange
    const text = asset('codex-home/config.toml');
    // Assert
    expect(text).toBe(aiDocBlock('toml', '# file: services/ai-gateway/assets/codex-home/config.toml'));
    expect(text.split('\n')).toHaveLength(8);
    for (const forbidden of ['mcp_servers', '[hooks', '[profiles', 'model_provider']) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
  });
});
