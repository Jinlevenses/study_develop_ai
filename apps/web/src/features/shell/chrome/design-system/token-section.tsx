import { type ThemeMode, TOKENS } from '@fathom/design-tokens/tokens';
import { DataTable } from '@fathom/ui/components/data-table';
import { MATERIAL } from '@fathom/ui/lib/materials';
import type { ReactElement } from 'react';

interface ColorRow {
  readonly role: string;
  readonly cssVar: string;
  readonly value: string;
}

/** TOKENS.color[mode]를 역할 이름·CSS 변수·OKLCH 값 행으로 펼친다(DS-01 §14). */
export function colorRows(mode: ThemeMode): readonly ColorRow[] {
  const c = TOKENS.color[mode];
  const rows: ColorRow[] = [
    { role: 'bg', cssVar: '--bg', value: c.bg },
    { role: 'surface-1', cssVar: '--surface-1', value: c.surface[0] },
    { role: 'surface-2', cssVar: '--surface-2', value: c.surface[1] },
    { role: 'surface-3', cssVar: '--surface-3', value: c.surface[2] },
    { role: 'border', cssVar: '--border', value: c.border.base },
    { role: 'border-strong', cssVar: '--border-strong', value: c.border.strong },
    { role: 'border-input', cssVar: '--border-input', value: c.border.input },
    { role: 'fg', cssVar: '--fg', value: c.fg.base },
    { role: 'fg-muted', cssVar: '--fg-muted', value: c.fg.muted },
    { role: 'fg-subtle', cssVar: '--fg-subtle', value: c.fg.subtle },
    { role: 'depth-1', cssVar: '--depth-1', value: c.depth[1] },
    { role: 'depth-2', cssVar: '--depth-2', value: c.depth[2] },
    { role: 'depth-3', cssVar: '--depth-3', value: c.depth[3] },
    { role: 'depth-4', cssVar: '--depth-4', value: c.depth[4] },
    { role: 'depth-5', cssVar: '--depth-5', value: c.depth[5] },
    { role: 'depth-fog', cssVar: '--depth-fog', value: c.depthFog },
    { role: 'on-depth', cssVar: '--on-depth', value: c.onDepth },
    { role: 'focus', cssVar: '--focus', value: c.focus },
    { role: 'due', cssVar: '--due', value: c.due },
    { role: 'due-ink', cssVar: '--due-ink', value: c.dueInk },
    { role: 'correct', cssVar: '--correct', value: c.correct },
    { role: 'incorrect', cssVar: '--incorrect', value: c.incorrect },
  ];
  c.viz.seq.forEach((value, i) => {
    rows.push({ role: `viz-seq-${String(i + 1)}`, cssVar: `--viz-seq-${String(i + 1)}`, value });
  });
  rows.push(
    { role: 'viz-div-neg', cssVar: '--viz-div-neg', value: c.viz.div.neg },
    { role: 'viz-div-mid', cssVar: '--viz-div-mid', value: c.viz.div.mid },
    { role: 'viz-div-pos', cssVar: '--viz-div-pos', value: c.viz.div.pos },
  );
  for (const [name, value] of Object.entries(c.syntax)) {
    rows.push({ role: `syn-${name}`, cssVar: `--syn-${name}`, value });
  }
  return rows;
}

export function TokenSection({ mode }: { mode: ThemeMode }): ReactElement {
  const rows = colorRows(mode);
  return (
    <section aria-labelledby="ds-tokens" className="flex flex-col gap-3">
      <h2 id="ds-tokens" className="text-lg text-fg">
        토큰·색
      </h2>
      <DataTable
        caption={`${mode === 'dark' ? '다크' : '라이트'} 테마 색 역할`}
        columns={[
          {
            key: 'swatch',
            header: '견본',
            cell: (r) => (
              <span
                aria-hidden="true"
                className="inline-block size-4 rounded-inline border border-border"
                style={{ backgroundColor: `var(${r.cssVar})` }}
              />
            ),
          },
          { key: 'role', header: '역할', cell: (r) => <code>{r.role}</code> },
          { key: 'value', header: 'OKLCH', cell: (r) => <code>{r.value}</code> },
        ]}
        rows={rows}
        rowKey={(r) => r.role}
        visibleRows={12}
      />
    </section>
  );
}

const MATERIAL_ROWS = [
  ['inline', MATERIAL.inline],
  ['control', MATERIAL.control],
  ['panel', MATERIAL.panel],
  ['popover', MATERIAL.popover],
  ['modal', MATERIAL.modal],
  ['pill', MATERIAL.pill],
] as const;

/** 재질·반경·그림자 견본 6종(DS-01 §6.1). */
export function MaterialSection(): ReactElement {
  return (
    <section aria-labelledby="ds-material" className="flex flex-col gap-3">
      <h2 id="ds-material" className="text-lg text-fg">
        재질·반경·그림자
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {MATERIAL_ROWS.map(([name, cls]) => (
          <li key={name} className={`${cls} flex h-16 items-center justify-center px-3 text-sm text-fg`}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 모션 길이 토큰 표(DS-01 §8). */
export function MotionSection(): ReactElement {
  const rows = Object.entries(TOKENS.dur).map(([name, ms]) => ({ name, ms }));
  return (
    <section aria-labelledby="ds-motion" className="flex flex-col gap-3">
      <h2 id="ds-motion" className="text-lg text-fg">
        모션
      </h2>
      <DataTable
        caption="모션 길이 토큰(ms)"
        columns={[
          { key: 'name', header: '이름', cell: (r) => <code>{r.name}</code> },
          { key: 'ms', header: '길이(ms)', numeric: true, cell: (r) => String(r.ms) },
        ]}
        rows={rows}
        rowKey={(r) => r.name}
      />
    </section>
  );
}
