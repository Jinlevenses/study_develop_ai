import type { ThemeMode } from '@fathom/design-tokens/tokens';
import { Panel } from '@fathom/ui/components/panel';
import { SegmentedControl } from '@fathom/ui/components/segmented-control';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type ReactElement, useEffect } from 'react';
import { applyDocAttrs, currentDocTheme, readThemePref, resolveDocAttrs, windowMedia } from '../../../../lib/theme.js';
import { BadgeSection } from './badge-section.js';
import { ComponentSection } from './component-section.js';
import { MaterialSection, MotionSection, TokenSection } from './token-section.js';
import { TypeSection } from './type-section.js';

const THEME_OPTIONS = [
  { value: 'dark', label: '다크' },
  { value: 'light', label: '라이트' },
] as const;

/** SCR-18 `/_design` — 토큰·컴포넌트 기준선. search `theme`·`contrast`는 저장 없이 속성만 덮어쓴다(E2E-506 스크린샷용). */
export function DesignSystemPage(): ReactElement {
  const search = useSearch({ from: '/_design' });
  const navigate = useNavigate();
  const theme = search.theme;
  const contrast = search.contrast;
  useEffect(() => {
    if (theme === undefined && contrast === undefined) {
      return;
    }
    const root = document.documentElement;
    const base = resolveDocAttrs(readThemePref(), windowMedia());
    applyDocAttrs(root, { ...base, theme: theme ?? base.theme, contrast: contrast ?? base.contrast });
    return () => {
      applyDocAttrs(root, resolveDocAttrs(readThemePref(), windowMedia()));
    };
  }, [theme, contrast]);
  const mode: ThemeMode = theme ?? currentDocTheme();
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl text-fg">디자인 시스템 · 토큰·컴포넌트 기준선</h1>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={mode}
          aria-label="테마 보기"
          onValueChange={(v) => {
            if (v === 'dark' || v === 'light') {
              void navigate({ to: '/_design', search: { theme: v, contrast } });
            }
          }}
        />
      </header>
      <TokenSection mode={mode} />
      <TypeSection />
      <MaterialSection />
      <MotionSection />
      <ComponentSection />
      <BadgeSection />
      <Panel heading="화면 상태 스토리">
        <p>18화면 × 7상태 스토리 수집은 후속 WP-03-20에서 채워집니다.</p>
      </Panel>
    </div>
  );
}
