import clsx from 'clsx'

/**
 * GapTable — portada do App Master.
 * columns: [{ key, label, align?, colorSign?, fmt? }]
 */
export default function GapTable({ columns = [], rows = [], wrap = false, maxHeight = 540, rowClass, empty = 'sem dados' }) {
  const body = (
    <table className="gap-table">
      <thead>
        <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={row.id ?? ri} className={rowClass ? rowClass(row) : undefined}>
            {columns.map((c) => {
              const raw = row[c.key]
              const val = c.fmt ? c.fmt(raw, row) : raw ?? '—'
              const sv = typeof val === 'string' ? val.trim() : val
              const signCls =
                c.colorSign && typeof sv === 'string'
                  ? sv.startsWith('+') ? 'var-pos' : sv.startsWith('−') || sv.startsWith('-') ? 'var-neg' : ''
                  : ''
              return (
                <td key={c.key} className={clsx('num', signCls)} style={c.align ? { textAlign: c.align } : undefined}>
                  {val}
                </td>
              )
            })}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={columns.length} className="text-gap-muted py-4">{empty}</td></tr>
        )}
      </tbody>
    </table>
  )
  if (wrap) {
    return (
      <div className="border border-gap-border rounded-md overflow-auto relative [contain:paint]" style={{ maxHeight }}>
        {body}
      </div>
    )
  }
  return <div className="overflow-x-auto">{body}</div>
}
