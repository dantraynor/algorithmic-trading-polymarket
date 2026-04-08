'use client';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

interface Props {
  columns: Column[];
  rows: Record<string, any>[];
  onRowClick?: (row: Record<string, any>) => void;
  selectedKey?: string;
}

export function DataTable({ columns, rows, onRowClick, selectedKey }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-bb-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-[2px] px-2 text-[10px] uppercase tracking-wider text-bb-cyan font-medium ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = row.id ?? row.key ?? i;
            const isSelected = selectedKey != null && String(key) === String(selectedKey);
            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(row)}
                className={`
                  cursor-pointer transition-colors
                  ${isSelected ? 'border-l-2 border-bb-cyan bg-bb-panel' : 'border-l-2 border-transparent'}
                  hover:bg-bb-border/30
                `}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-[2px] px-2 text-[11px] text-bb-text font-mono tabular-nums ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
