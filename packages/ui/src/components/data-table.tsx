import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { useWindowedRows } from '../hooks/use-windowed-rows.js';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './table.js';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  numeric?: boolean;
  cell: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  visibleRows?: number;
};

const WINDOW_THRESHOLD = 200;
const FALLBACK_ROW_HEIGHT = 36;

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty = '표시할 항목이 없습니다',
  visibleRows = 15,
}: DataTableProps<T>): ReactElement {
  const windowed = rows.length > WINDOW_THRESHOLD;
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT);
  const win = useWindowedRows({ count: windowed ? rows.length : 0, rowHeight });
  const { containerRef } = win;
  const attach = useCallback(
    (el: HTMLElement | null): void => {
      containerRef(el);
      if (el !== null) {
        const px = Number.parseFloat(getComputedStyle(el).getPropertyValue('--row-h'));
        setRowHeight(px > 0 ? px : FALLBACK_ROW_HEIGHT);
      }
    },
    [containerRef],
  );

  const head = (
    <TableHeader>
      <TableRow aria-rowindex={windowed ? 1 : undefined}>
        {columns.map((c) => (
          <TableHead key={c.key} numeric={c.numeric}>
            {c.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );

  if (rows.length === 0) {
    return (
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        {head}
        <TableBody>
          <TableRow>
            <TableCell colSpan={columns.length} className="text-center text-fg-muted">
              {empty}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  const shown = windowed ? rows.slice(win.start, win.end) : rows;
  const first = windowed ? win.start : 0;
  const bottom = windowed ? win.totalHeight - win.end * rowHeight : 0;
  return (
    <Table
      aria-rowcount={windowed ? rows.length + 1 : undefined}
      wrapperProps={
        windowed
          ? {
              ref: attach,
              'data-windowed': 'true',
              style: { maxBlockSize: `calc(var(--row-h) * ${visibleRows})` },
            }
          : undefined
      }
    >
      <TableCaption className="sr-only">{caption}</TableCaption>
      {head}
      <TableBody>
        {windowed ? (
          // biome-ignore lint/a11y/noAriaHiddenOnFocusable: 창 목록 스페이서 행은 포커스 불가이며 보조 기술에 숨긴다(DN-D6)
          <tr aria-hidden="true">
            <td colSpan={columns.length} className="p-0" style={{ blockSize: win.offsetTop }} />
          </tr>
        ) : null}
        {shown.map((row, i) => (
          <TableRow key={rowKey(row)} aria-rowindex={windowed ? first + i + 2 : undefined}>
            {columns.map((c) => (
              <TableCell key={c.key} numeric={c.numeric}>
                {c.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {windowed ? (
          // biome-ignore lint/a11y/noAriaHiddenOnFocusable: 창 목록 스페이서 행은 포커스 불가이며 보조 기술에 숨긴다(DN-D6)
          <tr aria-hidden="true">
            <td colSpan={columns.length} className="p-0" style={{ blockSize: bottom }} />
          </tr>
        ) : null}
      </TableBody>
    </Table>
  );
}
