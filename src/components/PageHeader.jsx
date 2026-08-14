import { useLocation } from 'react-router-dom'

export default function PageHeader({ title, subtitle, right }) {
  const loc = useLocation()
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 border-b border-gap-border pb-2.5 mb-4 relative">
      <span key={loc.pathname} className="header-dash absolute -bottom-px left-0 w-14 h-[2.5px] rounded-full bg-gap-blue" aria-hidden />
      <div className="min-w-0">
        <h1 className="text-[19px] font-bold tracking-tight text-gap-navy leading-none">{title}</h1>
        {subtitle && <div className="text-[12.5px] text-gap-muted mt-1.5">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-3 flex-wrap">{right}</div>}
    </div>
  )
}
