"use client";

import {
  QUESTION_TABLE_MAX_COLUMNS,
  QUESTION_TABLE_MAX_ROWS,
  type TableContentBlock,
} from "@/lib/questions/content";

const FIELD_CLASS =
  "rounded-lg border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function TableBlockEditor({
  block,
  onChange,
}: {
  block: TableContentBlock;
  onChange: (block: TableContentBlock) => void;
}) {
  const width = block.rows[0]?.length ?? 0;
  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    const rows = block.rows.map((row) => [...row]);
    rows[rowIndex][columnIndex] = value;
    onChange({ ...block, rows });
  };

  return (
    <div>
      <div className="max-w-full overflow-x-auto pb-1">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr>
              {Array.from({ length: width }, (_, columnIndex) => (
                <th key={columnIndex} className="border border-hairline bg-surface p-2 text-center">
                  <span className="mr-2 text-xs text-muted">Column {columnIndex + 1}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...block, rows: block.rows.map((row) => row.filter((_, index) => index !== columnIndex)) })}
                    disabled={width <= 1}
                    aria-label={`Delete column ${columnIndex + 1}`}
                    className="text-xs font-semibold text-miss-ink disabled:opacity-30"
                  >
                    Delete
                  </button>
                </th>
              ))}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="border border-hairline p-1.5">
                    <input
                      value={cell}
                      onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                      maxLength={1000}
                      aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`}
                      className={`${FIELD_CLASS} min-w-32`}
                    />
                  </td>
                ))}
                <td className="px-2 text-center">
                  <button
                    type="button"
                    onClick={() => onChange({ ...block, rows: block.rows.filter((_, index) => index !== rowIndex) })}
                    disabled={block.rows.length <= 1}
                    aria-label={`Delete row ${rowIndex + 1}`}
                    className="text-xs font-semibold text-miss-ink disabled:opacity-30"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...block, rows: [...block.rows, Array(width).fill("")] })}
          disabled={block.rows.length >= QUESTION_TABLE_MAX_ROWS}
          className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          + Row
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...block, rows: block.rows.map((row) => [...row, ""]) })}
          disabled={width >= QUESTION_TABLE_MAX_COLUMNS}
          className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          + Column
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm font-medium text-muted">
          <input
            type="checkbox"
            checked={block.header}
            onChange={(event) => onChange({ ...block, header: event.target.checked })}
            className="accent-accent"
          />
          First row is a header
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">
        Cells support the same single-dollar inline LaTeX as normal text.
      </p>
    </div>
  );
}
