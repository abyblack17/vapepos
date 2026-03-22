import React from 'react'

export default function Table({ columns, data, emptyMsg = 'Sin resultados', onRowClick }) {
  return (
    <div className="table-container overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} className="table-header" style={{ width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-slate-500 text-sm"
              >
                {emptyMsg}
              </td>
            </tr>
          ) : (
            data.map((row, ri) => (
              <tr
                key={row.id || ri}
                className={`table-row ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col, ci) => (
                  <td key={ci} className="table-cell">
                    {col.render ? col.render(row) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
