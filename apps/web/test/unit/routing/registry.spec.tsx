import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FormatId } from '@fathom/contracts/common/domain';
import { BlockKind } from '@fathom/contracts/http/learning/v1/sessions';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RENDERERS } from '../../../src/features/practice/renderers/registry.js';
import { NotYetRenderer } from '../../../src/lib/not-yet-renderer.js';
import './support/harness.js';

const REGISTRY_PATH = join(import.meta.dirname, '../../../src/features/practice/renderers/registry.ts');
const MANIFEST_PATH = join(import.meta.dirname, '../../../../../packages/contracts/manifests/modes.manifest.json');

const KBD = new Set(['global', 'player', 'timeline', 'ox', 'choice', 'cloze', 'list', 'editor', 'reorder', 'matching', 'bugline', 'srs', 'note', 'dialog', 'depth_map', 'lesson', 'form', 'none']);
const OFFLINE = new Set(['deterministic', 'self', 'pending', 'alt_evidence']);
const FORBIDDEN = ['실패', '게으름', '연체', '밀린', '놓쳤', '스트릭이 끊', '잃게 됩니다', 'XP', '코인', '레벨업!', '랭킹'];

describe('renderer registry', () => {
  it('UT-WEB-444 RENDERERS 키 집합은 FormatId ∪ BlockKind(41)이고 offline·kbd가 유효하며 전부 NotYetRenderer다 [FR-STD-033][FR-UX-016]', () => {
    const expected = [...new Set([...FormatId.options, ...BlockKind.options])].sort();
    expect(expected).toHaveLength(41);
    expect(Object.keys(RENDERERS).sort()).toEqual(expected);
    for (const [key, entry] of Object.entries(RENDERERS)) {
      expect(KBD.has(entry.kbd), `${key} kbd`).toBe(true);
      expect(OFFLINE.has(entry.offline), `${key} offline`).toBe(true);
      expect(entry.component, key).toBe(NotYetRenderer);
      expect(entry.e2e_id === null || /^E2E-3\d\d$/.test(entry.e2e_id), `${key} e2e_id`).toBe(true);
    }
  });

  it('UT-WEB-445 registry.ts의 첫 = { 직후가 RENDERERS 리터럴이고 e2e_id 집합이 매니페스트 21모드의 E2E ID를 모두 포함한다 [FR-STD-033][CR-68]', () => {
    const src = readFileSync(REGISTRY_PATH, 'utf8');
    const firstObject = src.search(/=\s*\{/);
    expect(firstObject).toBeGreaterThan(0);
    expect(src.slice(src.lastIndexOf('\n', firstObject) + 1, firstObject)).toMatch(/^export const RENDERERS\s*$/);
    expect(src).not.toMatch(/type\s+\w+\s*=\s*\{/);
    expect(src).not.toMatch(/\.\.\./); // 스프레드·루프·계산 키 0
    const ids = new Set([...src.matchAll(/e2e_id:\s*'(E2E-\d+)'/g)].map((m) => m[1]));
    const manifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const modes =
      typeof manifest === 'object' && manifest !== null && 'modes' in manifest && Array.isArray(manifest.modes) ? manifest.modes : [];
    expect(modes).toHaveLength(21);
    for (const mode of modes) {
      const e2eIds: unknown = mode.e2e_ids;
      const list = Array.isArray(e2eIds) ? e2eIds.filter((x): x is string => typeof x === 'string' && x.startsWith('E2E-')) : [];
      expect(list.length, `${String(mode.mode_id)} e2e`).toBeGreaterThan(0);
      for (const id of list) {
        expect(ids.has(id), `${String(mode.mode_id)} ${id}`).toBe(true);
      }
    }
    // 키 순서: FormatId 선언 순 → BlockKind 나머지 8개
    const keys = Object.keys(RENDERERS);
    expect(keys.slice(0, 33)).toEqual([...FormatId.options]);
    expect(keys.slice(33)).toEqual(['lesson', 'items', 'dialog', 'lab', 'case', 'jol', 'reflection', 'triage']);
  });

  it('UT-WEB-446 NotYetRenderer는 문구·data-renderer-key·행동 1개를 보이고 금지 어휘가 0이다 [FR-UX-011]', async () => {
    const Comp = RENDERERS.ox.component;
    const root = createRootRoute({ component: () => <Comp blockId="b1" itemKey="i1" rendererKey="ox" /> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
    const { container } = render(<RouterProvider router={router} />);
    await screen.findByText('이 형식은 아직 준비 중입니다');
    expect(container.querySelector('[data-renderer-key="ox"]')).not.toBeNull();
    expect(container.textContent).toContain('ox');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('button')?.textContent).toBe('세션 목록으로');
    for (const word of FORBIDDEN) {
      expect(container.textContent ?? '', word).not.toContain(word);
    }
  });
});
