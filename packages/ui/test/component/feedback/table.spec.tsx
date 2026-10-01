import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from '../../../src/components/data-table.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../src/components/table.js';

afterEach(cleanup);

type Row = { id: string; name: string; n: number };
const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: '이름', cell: (r) => r.name },
  { key: 'n', header: '수', numeric: true, cell: (r) => String(r.n) },
];
const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `행 ${i}`, n: i }));

describe('Table', () => {
  it('UT-UI-065 numeric 셀·헤드는 data-numeric·num·text-right이고 헤드는 scope=col·sticky이다 [FR-UX-007]', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead numeric>수</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell numeric>12</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const th = screen.getByRole('columnheader', { name: '수' });
    const td = screen.getByRole('cell', { name: '12' });
    for (const el of [th, td]) {
      expect(el.hasAttribute('data-numeric')).toBe(true);
      expect(el.className).toContain('num');
      expect(el.className).toContain('text-right');
    }
    expect(th.getAttribute('scope')).toBe('col');
    expect(th.className).toContain('sticky');
    expect(th.parentElement?.parentElement?.className).toContain('sticky');
  });
});

describe('DataTable', () => {
  it('UT-UI-066 50행은 데이터 행 50개·caption sr-only이고 0행은 기본 빈 문구이다 [FR-UX-007]', () => {
    const { container, rerender } = render(
      <DataTable caption="목록" columns={COLUMNS} rows={makeRows(50)} rowKey={(r) => r.id} />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(container.querySelector('caption')?.className).toContain('sr-only');
    expect(container.querySelector('[data-windowed]')).toBeNull();
    rerender(<DataTable caption="목록" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText('표시할 항목이 없습니다')).not.toBeNull();
  });

  it('UT-UI-067 1000행은 스크롤 위치에 맞는 22행만 렌더하고 aria-rowindex·aria-rowcount를 단다 [FR-UX-007]', () => {
    const { container } = render(
      <DataTable caption="큰 목록" columns={COLUMNS} rows={makeRows(1000)} rowKey={(r) => r.id} />,
    );
    const scroller = container.querySelector('[data-windowed="true"]') as HTMLElement;
    expect(scroller.className).toContain('overflow-auto');
    expect(scroller.style.maxBlockSize).toBe('calc(var(--row-h) * 15)');
    Object.defineProperty(scroller, 'clientHeight', { value: 360, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 3600, configurable: true, writable: true });
    fireEvent.scroll(scroller);
    const dataRows = container.querySelectorAll('tbody tr:not([aria-hidden])');
    expect(dataRows).toHaveLength(22);
    expect(dataRows[0]?.getAttribute('aria-rowindex')).toBe('96');
    expect(container.querySelector('table')?.getAttribute('aria-rowcount')).toBe('1001');
    expect(screen.getByText('행 94')).not.toBeNull();
    expect(screen.queryByText('행 93')).toBeNull();
    const spacers = container.querySelectorAll('tbody tr[aria-hidden="true"] td');
    expect((spacers[0] as HTMLElement).style.blockSize).toBe('3384px');
    expect((spacers[1] as HTMLElement).style.blockSize).toBe(`${36000 - 116 * 36}px`);
  });
});
