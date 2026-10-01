import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ModeEntry, ModesManifest, Ur14Family } from '../../../src/manifests/modes.js';
import { ReqId, VClass, VerificationClass } from '../../../src/manifests/verification-class.js';

const manifestPath = (name: string) => fileURLToPath(new URL(`../../../manifests/${name}`, import.meta.url));
const readText = (name: string) => readFile(manifestPath(name), 'utf8');
const readJson = async (name: string): Promise<unknown> => JSON.parse(await readText(name));

// 독립 기대표: RTM-01 §7 (FR/NFR ID → beyond)
const EXPECTED_EXCEPTIONS: Record<string, string[]> = {
  'FR-AI-001': ['V-live'],
  'FR-AI-005': ['V-live'],
  'FR-AI-006': ['V-live'],
  'FR-AI-014': ['V-live'],
  'FR-AI-015': ['V-live'],
  'FR-DSH-013': ['V-field'],
  'FR-IMP-006': ['V-live'],
  'FR-LAB-011': ['V-live'],
  'FR-PRG-018': ['V-field'],
  'FR-QST-012': ['V-live'],
  'FR-SET-024': ['V-ci', 'V-live'],
  'FR-UX-004': ['V-ci'],
  'NFR-AVL-001': ['V-ci'],
  'NFR-PERF-010': ['V-field'],
  'NFR-PORT-001': ['V-ci'],
  'NFR-PORT-004': ['V-ci'],
  'NFR-PORT-008': ['V-ci'],
  'NFR-PORT-009': ['V-ci'],
  'NFR-SEC-005': ['V-ci'],
  'NFR-SEC-008': ['V-live'],
  'NFR-SEC-020': ['V-live'],
  'NFR-UX-005': ['V-field'],
  'NFR-UX-006': ['V-ci'],
};

describe('manifests/modes', () => {
  it('UT-CON-006 modes.manifest.json이 ModesManifest를 통과하고 UR-14 6계열마다 included ≥ 1이며 M-01~M-21 전부다 [FR-STD-033]', async () => {
    const raw = await readJson('modes.manifest.json');
    const parsed = ModesManifest.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const { modes } = parsed.data;
    expect(modes.map((m) => m.mode_id)).toEqual(
      Array.from({ length: 21 }, (_, i) => `M-${String(i + 1).padStart(2, '0')}`),
    );
    for (const family of Ur14Family.options) {
      const included = modes.filter((m) => m.ur14_family === family && m.status === 'included');
      expect(included.length, family).toBeGreaterThanOrEqual(1);
    }
    expect(Ur14Family.options).toEqual(['개념이해', '실습', '문제', '개념 디깅', 'OX', '백지노트']);
    // 스키마 경계
    expect(ModesManifest.safeParse({ version: 1, modes: modes.slice(0, 20) }).success).toBe(false);
    expect(ModesManifest.safeParse({ version: 2, modes }).success).toBe(false);
    expect(ModesManifest.safeParse({ version: 1, modes: [...modes.slice(0, 20), modes[0]] }).success).toBe(false); // 중복 mode_id
    const first = modes[0] as Record<string, unknown>;
    expect(ModeEntry.safeParse({ ...first, status: 'cut' }).success).toBe(false);
    expect(ModeEntry.safeParse({ ...first, ur14_family: '실습(판단)' }).success).toBe(false);
    expect(ModeEntry.safeParse({ ...first, e2e_ids: [] }).success).toBe(false);
    expect(ModeEntry.safeParse({ ...first, e2e_ids: ['E2E-1'] }).success).toBe(false);
    expect(ModeEntry.safeParse({ ...first, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-091 modes.manifest.json e2e_ids가 M-nn ↔ E2E-3nn 대응이다(M-01 → E2E-301 …) [FR-STD-033][DR-028]', async () => {
    const parsed = ModesManifest.parse(await readJson('modes.manifest.json'));
    for (const m of parsed.modes) {
      const nn = m.mode_id.slice(2);
      expect(m.e2e_ids[0], m.mode_id).toBe(`E2E-3${nn}`);
      for (const id of m.e2e_ids) {
        expect(id, m.mode_id).toMatch(/^(E2E-\d{3}|SCN-\d{2})$/);
      }
    }
    const byId = Object.fromEntries(parsed.modes.map((m) => [m.mode_id, m]));
    expect(byId['M-01']?.e2e_ids).toEqual(['E2E-301', 'SCN-01']);
    expect(byId['M-13']?.e2e_ids).toEqual(['E2E-313', 'SCN-03']);
    expect(byId['M-19']?.ur14_family).toBe('실습'); // RTM의 '실습(판단)'은 '실습'으로 정규화
    expect(byId['M-14']?.ur14_family).toBe('개념 디깅');
    expect(byId['M-21']?.ur14_family).toBe('백지노트');
    // RTM 표: 괄호 속 "컷 … 시 deferred"는 조건 설명이므로 전부 included
    expect(parsed.modes.every((m) => m.status === 'included')).toBe(true);
  });
});

describe('manifests/verification-class', () => {
  it('UT-CON-090 verification-class.json이 VerificationClass를 통과하고 예외 23개·default V-build다 [DR-028]', async () => {
    const raw = await readJson('verification-class.json');
    const parsed = VerificationClass.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.default).toBe('V-build');
    expect(Object.keys(parsed.data.exceptions)).toHaveLength(23);
    expect(Object.keys(parsed.data.exceptions).sort()).toEqual(Object.keys(EXPECTED_EXCEPTIONS).sort());
    for (const [id, want] of Object.entries(EXPECTED_EXCEPTIONS)) {
      const got = parsed.data.exceptions[id];
      expect(got, id).toEqual({ build: true, beyond: want });
    }
    // 스키마 경계
    expect(VClass.options).toEqual(['V-ci', 'V-live', 'V-field']);
    expect(ReqId.safeParse('FR-AI-001').success).toBe(true);
    expect(ReqId.safeParse('NFR-SEC-020').success).toBe(true);
    expect(ReqId.safeParse('UR-01').success).toBe(false);
    expect(ReqId.safeParse('FR-AI-1').success).toBe(false);
    expect(VerificationClass.safeParse({ default: 'V-ci', exceptions: {} }).success).toBe(false);
    expect(
      VerificationClass.safeParse({ default: 'V-build', exceptions: { 'FR-AI-001': { build: true, beyond: [] } } })
        .success,
    ).toBe(false);
    expect(
      VerificationClass.safeParse({
        default: 'V-build',
        exceptions: { 'FR-AI-001': { build: true, beyond: ['V-build'] } },
      }).success,
    ).toBe(false);
    expect(
      VerificationClass.safeParse({ default: 'V-build', exceptions: { bad: { build: true, beyond: ['V-ci'] } } })
        .success,
    ).toBe(false);
  });

  it('UT-CON-092 매니페스트 JSON 파일은 2칸 들여쓰기이고 끝 줄바꿈이 정확히 1개다 [DR-028][FR-STD-033]', async () => {
    for (const name of ['modes.manifest.json', 'verification-class.json']) {
      const text = await readText(name);
      expect(text.endsWith('\n'), name).toBe(true);
      expect(text.endsWith('\n\n'), name).toBe(false);
      expect(text.includes('\t'), name).toBe(false);
      expect(text.includes('\r'), name).toBe(false);
      expect(text.startsWith('{\n  "'), name).toBe(true);
      for (const line of text.split('\n')) {
        const indent = line.length - line.trimStart().length;
        expect(indent % 2, `${name}: ${line}`).toBe(0);
      }
      expect(JSON.parse(text), name).toBeTypeOf('object');
    }
    // 키 순서 = 스키마 순서
    const modes = JSON.parse(await readText('modes.manifest.json')) as {
      version: number;
      modes: Record<string, unknown>[];
    };
    expect(Object.keys(modes)).toEqual(['version', 'modes']);
    expect(Object.keys(modes.modes[0] ?? {})).toEqual([
      'mode_id',
      'name_ko',
      'ur14_family',
      'offline_path',
      'e2e_ids',
      'status',
    ]);
    const vc = JSON.parse(await readText('verification-class.json')) as Record<string, unknown>;
    expect(Object.keys(vc)).toEqual(['default', 'exceptions']);
  });
});
