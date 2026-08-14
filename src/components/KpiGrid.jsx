import clsx from 'clsx'

// items: [{ label, value, sub, tone }]  tone: 'pos' (vermelho/gasto) | 'neg' (verde/sobra)
export default function KpiGrid({ items = [] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {items.map((it, i) => (
        <div
          key={i}
          className="bg-gap-soft border border-[#e3eef7] border-l-4 border-l-gap-blue rounded-md px-3.5 py-2.5"
        >
          <div className="text-[10.5px] uppercase tracking-wide text-gap-muted">{it.label}</div>
          <div
            className={clsx(
              'text-[1.35rem] font-bold mt-0.5 num',
              it.tone === 'pos' && 'text-gap-red',
              it.tone === 'neg' && 'text-gap-green',
              !it.tone && 'text-gap-navy'
            )}
          >
            {it.value ?? '—'}
          </div>
          {it.sub && <div className="text-[10.5px] text-gap-muted mt-0.5">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
