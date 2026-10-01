import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as aiModeChip from '../../../src/badges/ai-mode-chip.js';
import * as dataClassTag from '../../../src/badges/data-class-tag.js';
import * as judgeBadge from '../../../src/badges/judge-badge.js';
import * as levelBadge from '../../../src/badges/level-badge.js';
import * as reasonChip from '../../../src/badges/reason-chip.js';
import * as stateTag from '../../../src/badges/state-tag.js';
import * as statusDot from '../../../src/badges/status-dot.js';
import * as tierTag from '../../../src/badges/tier-tag.js';
import * as trustTag from '../../../src/badges/trust-tag.js';
import * as aiOfflineNote from '../../../src/components/ai-offline-note.js';
import * as alertDialog from '../../../src/components/alert-dialog.js';
import * as banner from '../../../src/components/banner.js';
import * as button from '../../../src/components/button.js';
import * as card from '../../../src/components/card.js';
import * as checkbox from '../../../src/components/checkbox.js';
import * as command from '../../../src/components/command.js';
import * as confirmByName from '../../../src/components/confirm-by-name.js';
import * as contextMenu from '../../../src/components/context-menu.js';
import * as dataTable from '../../../src/components/data-table.js';
import * as degradedStrip from '../../../src/components/degraded-strip.js';
import * as dialog from '../../../src/components/dialog.js';
import * as drawer from '../../../src/components/drawer.js';
import * as dropdownMenu from '../../../src/components/dropdown-menu.js';
import * as emptyState from '../../../src/components/empty-state.js';
import * as errorPanel from '../../../src/components/error-panel.js';
import * as hoverCard from '../../../src/components/hover-card.js';
import * as iconButton from '../../../src/components/icon-button.js';
import * as imeSafeInput from '../../../src/components/ime-safe-input.js';
import * as imeSafeTextarea from '../../../src/components/ime-safe-textarea.js';
import * as input from '../../../src/components/input.js';
import * as kbd from '../../../src/components/kbd.js';
import * as liveRegion from '../../../src/components/live-region.js';
import * as meter from '../../../src/components/meter.js';
import * as panel from '../../../src/components/panel.js';
import * as popover from '../../../src/components/popover.js';
import * as progress from '../../../src/components/progress.js';
import * as radioGroup from '../../../src/components/radio-group.js';
import * as segmentedControl from '../../../src/components/segmented-control.js';
import * as select from '../../../src/components/select.js';
import * as skeleton from '../../../src/components/skeleton.js';
import * as stepper from '../../../src/components/stepper.js';
import * as switchMod from '../../../src/components/switch.js';
import * as table from '../../../src/components/table.js';
import * as tabs from '../../../src/components/tabs.js';
import * as textarea from '../../../src/components/textarea.js';
import * as toast from '../../../src/components/toast.js';
import * as toggleGroup from '../../../src/components/toggle-group.js';
import * as tooltip from '../../../src/components/tooltip.js';
import { cn } from '../../../src/lib/cn.js';

const SRC = join(import.meta.dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const FILES = walk(SRC).map((path) => ({ path, rel: relative(SRC, path), text: readFileSync(path, 'utf8') }));

function offenders(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    for (const m of f.text.matchAll(re)) {
      out.push(`${f.rel}: ${m[0]}`);
    }
  }
  return out;
}

describe('정적 스캔 — packages/ui/src', () => {
  it('UT-UI-096 원색 리터럴·기본 팔레트·값 대괄호·금지 클래스·금지 어휘가 0이다 [FR-UX-001][FR-UX-008][NFR-UX-009]', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(53);
    expect(offenders(/#[0-9a-fA-F]{3,8}\b/g)).toEqual([]);
    expect(offenders(/\b(rgba?|hsla?|oklch|oklab|hwb)\(/g)).toEqual([]);
    const palette =
      /\b(bg|text|border|ring|fill|stroke)-(slate|gray|zinc|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/g;
    expect(offenders(palette)).toEqual([]);
    expect(offenders(/-\[#/g)).toEqual([]);
    expect(offenders(/-\[(?![^\]]*=)[^\]]+\]/g)).toEqual([]);
    expect(offenders(/['"`\s]\[[a-z-]+:[^\]\s]+\]/g)).toEqual([]);
    for (const banned of ['uppercase', 'italic', 'duration-[', 'animate-spin', 'outline-none']) {
      expect(FILES.filter((f) => f.text.includes(banned)).map((f) => `${f.rel}: ${banned}`)).toEqual([]);
    }
    for (const word of ['연체', '밀린', '놓쳤', 'XP', '레벨업', '랭킹', '리더보드']) {
      expect(FILES.filter((f) => f.text.includes(word)).map((f) => `${f.rel}: ${word}`)).toEqual([]);
    }
  });

  it('UT-UI-097 import 지정자는 허용 목록뿐이고 default export·export *가 0이다 [FR-UX-001]', () => {
    const allowed = new Set([
      'react',
      'react-dom',
      'react/jsx-runtime',
      'radix-ui',
      'class-variance-authority',
      'tailwind-merge',
      'clsx',
      'motion/react',
      'lucide-react',
      'cmdk',
      'sonner',
    ]);
    const bad: string[] = [];
    for (const f of FILES) {
      for (const m of f.text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? '';
        const relative = (spec.startsWith('./') || spec.startsWith('../')) && spec.endsWith('.js');
        const tokens = /^@fathom\/design-tokens\/[a-z-]+$/.test(spec);
        if (!(relative || tokens || allowed.has(spec))) {
          bad.push(`${f.rel}: ${spec}`);
        }
      }
      if (
        /\bexport\s+default\b/.test(f.text) ||
        /\bexport\s+\*/.test(f.text) ||
        /\bexport\s*\{[^}]*\}\s*from\b/.test(f.text)
      ) {
        bad.push(`${f.rel}: default/재수출`);
      }
      if (/\brequire\(|import\(/.test(f.text)) {
        bad.push(`${f.rel}: 동적 import`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('UT-UI-098 아이콘 크기는 16·20, strokeWidth는 1.5이고 비결정·부작용 API가 0이다 [FR-UX-009]', () => {
    const sizes = [...FILES.flatMap((f) => [...f.text.matchAll(/\bsize=\{(\d+)\}/g)].map((m) => Number(m[1])))];
    for (const n of sizes) {
      expect([16, 20]).toContain(n);
    }
    const calls = [...FILES.flatMap((f) => [...f.text.matchAll(/\biconProps\((\d+)\)/g)].map((m) => Number(m[1])))];
    expect(calls.length).toBeGreaterThan(0);
    for (const n of calls) {
      expect([16, 20]).toContain(n);
    }
    const strokes = [
      ...FILES.flatMap((f) => [...f.text.matchAll(/\bstrokeWidth=\{([\d.]+)\}/g)].map((m) => Number(m[1]))),
    ];
    for (const n of strokes) {
      expect(n).toBe(1.5);
    }
    for (const banned of ['Date.now', 'Math.random', 'console.', 'localStorage']) {
      expect(FILES.filter((f) => f.text.includes(banned)).map((f) => `${f.rel}: ${banned}`)).toEqual([]);
    }
  });

  it('UT-UI-099 컴포넌트 39개·배지 9개 파일이 있고 PascalCase named export가 있으며 cn이 동작한다 [FR-UX-001]', () => {
    const components: [string, Record<string, unknown>][] = [
      ['button', button],
      ['icon-button', iconButton],
      ['kbd', kbd],
      ['input', input],
      ['ime-safe-input', imeSafeInput],
      ['textarea', textarea],
      ['ime-safe-textarea', imeSafeTextarea],
      ['select', select],
      ['checkbox', checkbox],
      ['radio-group', radioGroup],
      ['switch', switchMod],
      ['segmented-control', segmentedControl],
      ['toggle-group', toggleGroup],
      ['tabs', tabs],
      ['dialog', dialog],
      ['alert-dialog', alertDialog],
      ['confirm-by-name', confirmByName],
      ['drawer', drawer],
      ['popover', popover],
      ['hover-card', hoverCard],
      ['tooltip', tooltip],
      ['dropdown-menu', dropdownMenu],
      ['context-menu', contextMenu],
      ['command', command],
      ['toast', toast],
      ['banner', banner],
      ['card', card],
      ['panel', panel],
      ['table', table],
      ['data-table', dataTable],
      ['skeleton', skeleton],
      ['empty-state', emptyState],
      ['error-panel', errorPanel],
      ['degraded-strip', degradedStrip],
      ['ai-offline-note', aiOfflineNote],
      ['progress', progress],
      ['meter', meter],
      ['stepper', stepper],
      ['live-region', liveRegion],
    ];
    const badges: [string, Record<string, unknown>][] = [
      ['level-badge', levelBadge],
      ['judge-badge', judgeBadge],
      ['ai-mode-chip', aiModeChip],
      ['status-dot', statusDot],
      ['reason-chip', reasonChip],
      ['state-tag', stateTag],
      ['tier-tag', tierTag],
      ['trust-tag', trustTag],
      ['data-class-tag', dataClassTag],
    ];
    expect(components).toHaveLength(39);
    expect(badges).toHaveLength(9);
    for (const [dir, list] of [
      ['components', components],
      ['badges', badges],
    ] as const) {
      for (const [name, mod] of list) {
        expect(existsSync(join(SRC, dir, `${name}.tsx`)), `${dir}/${name}.tsx`).toBe(true);
        expect(
          Object.keys(mod).some((k) => /^[A-Z][A-Za-z0-9]*$/.test(k)),
          name,
        ).toBe(true);
        expect('default' in mod, `${name} default`).toBe(false);
      }
    }
    expect(cn('a', false, 'b')).toBe('a b');
  });
});
