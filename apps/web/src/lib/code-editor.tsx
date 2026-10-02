import { javascript } from '@codemirror/lang-javascript';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { fathomCodeMirrorTheme } from '@fathom/design-tokens/tokens';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { detectPlatform, type KeyboardEventLike, matchesCombo, type Platform, parseCombo } from './hotkeys.js';
import { isImeComposing } from './ime.js';
import { useDocTheme } from './theme.js';

export interface CodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly lang: 'js' | 'ts' | 'sql' | 'yaml';
  readonly readOnly?: boolean;
  readonly ariaLabel: string;
  readonly onSubmit?: () => void;
  readonly onRun?: () => void;
}

const SUBMIT = parseCombo('Mod+Shift+Enter');
const RUN = parseCombo('Mod+Enter');

/** ⌘/Ctrl+Shift+Enter = 제출, ⌘/Ctrl+Enter = 실행. IME 조합 중에는 null(FR-UX-004). */
export function editorKeyAction(e: KeyboardEventLike, platform: Platform): 'submit' | 'run' | null {
  if (isImeComposing(e)) {
    return null;
  }
  if (matchesCombo(e, SUBMIT, platform)) {
    return 'submit';
  }
  if (matchesCombo(e, RUN, platform)) {
    return 'run';
  }
  return null;
}

function languageExtension(lang: CodeEditorProps['lang']): Extension {
  switch (lang) {
    case 'js':
      return javascript();
    case 'ts':
      return javascript({ typescript: true });
    case 'sql':
      return sql();
    case 'yaml':
      return yaml();
  }
}

export function CodeEditor({
  value,
  onChange,
  lang,
  readOnly,
  ariaLabel,
  onSubmit,
  onRun,
}: CodeEditorProps): ReactElement {
  const mode = useDocTheme();
  const extensions = useMemo<Extension[]>(
    () => [
      languageExtension(lang),
      EditorView.theme(fathomCodeMirrorTheme[mode]),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      EditorView.domEventHandlers({
        keydown: (e: KeyboardEvent) => {
          const action = editorKeyAction(e, detectPlatform(navigator.userAgent));
          if (action === null) {
            return false;
          }
          e.preventDefault();
          if (action === 'submit') {
            onSubmit?.();
          } else {
            (onRun ?? onSubmit)?.();
          }
          return true;
        },
      }),
    ],
    [lang, mode, ariaLabel, onSubmit, onRun],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly === true}
      editable={readOnly !== true}
      theme="none"
      extensions={extensions}
      basicSetup={{ foldGutter: false }}
    />
  );
}
