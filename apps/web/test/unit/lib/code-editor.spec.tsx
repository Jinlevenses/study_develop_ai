import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeEditor, editorKeyAction } from '../../../src/lib/code-editor.js';
import type { KeyboardEventLike } from '../../../src/lib/hotkeys.js';

function ev(extra: Partial<KeyboardEventLike>): KeyboardEventLike {
  return { code: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra };
}

describe('code-editor', () => {
  it('UT-WEB-040 editorKeyAction은 Mod+Shift+Enter를 submit, Mod+Enter를 run으로 보고 조합 중에는 null이며 편집기가 aria-label로 마운트된다 [FR-UX-004][FR-UX-003]', async () => {
    expect(editorKeyAction(ev({ ctrlKey: true, shiftKey: true }), 'other')).toBe('submit');
    expect(editorKeyAction(ev({ metaKey: true, shiftKey: true }), 'mac')).toBe('submit');
    expect(editorKeyAction(ev({ ctrlKey: true }), 'other')).toBe('run');
    expect(editorKeyAction(ev({ metaKey: true }), 'mac')).toBe('run');
    expect(editorKeyAction(ev({ ctrlKey: true }), 'mac')).toBeNull();
    expect(editorKeyAction(ev({}), 'other')).toBeNull();
    expect(editorKeyAction(ev({ ctrlKey: true, code: 'KeyA' }), 'other')).toBeNull();
    expect(editorKeyAction(ev({ ctrlKey: true, isComposing: true }), 'other')).toBeNull();
    expect(editorKeyAction(ev({ ctrlKey: true, shiftKey: true, keyCode: 229 }), 'other')).toBeNull();
    expect(editorKeyAction(ev({ metaKey: true, nativeEvent: { isComposing: true } }), 'mac')).toBeNull();
    const { container } = render(
      <CodeEditor value="const a = 1;" onChange={() => undefined} lang="ts" ariaLabel="코드 편집기" />,
    );
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
    expect(container.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('코드 편집기');
    expect(container.textContent).toContain('const a = 1;');
  });
});
