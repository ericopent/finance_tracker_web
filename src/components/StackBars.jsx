import clsx from 'clsx'
import { monthLabel, moneyShort } from '../theme/gap'

/**
 * Barras empilhadas, uma por fatura. CSS puro — a tela de historico e das
 * primeiras que abrem no celular e nao justifica baixar um motor de graficos.
 *
 * meses:  [{ month, aberta, incompleta, partes: [{ cents, cor }], total }]
 * sel:    mes selecionado (clique troca)
 * linha:  valor de referencia (cents) desenhado como tracejado, opcional
 */
export default function StackBars({ meses = [], sel, onSel, linha = null, height = 170, rotulo }) {
  const max = Math.max(1, ...meses.map((m) => m.total), linha ?? 0) * 1.12
  const h = (c) => `${Math.max(0, (c / max) * 100)}%`
  // no celular nao cabem 13 rotulos: mostra um sim, um nao — e o selecionado sempre
  const passo = meses.length > 8 ? 2 : 1

  return (
    <div className="relative" style={{ height: height + 34 }}>
      {linha != null && linha > 0 && (
        <div
          className="absolute left-0 right-0 border-t border-dashed border-gap-muted/70 pointer-events-none z-10"
          style={{ bottom: `${34 + (linha / max) * height}px` }}
        >
          <span className="absolute right-0 -top-3.5 text-[9.5px] text-gap-muted bg-white/80 px-1 rounded">
            {rotulo ?? 'média'} {moneyShort(linha)}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 top-0 flex items-end gap-[3px] sm:gap-1.5" style={{ height }}>
        {meses.map((m, i) => {
          const ativo = m.month === sel
          return (
            <button
              key={m.month}
              onClick={() => onSel?.(m.month)}
              title={`${monthLabel(m.month)}: ${moneyShort(m.total)}${m.aberta ? ' (em aberto)' : ''}${m.incompleta ? ' (incompleta)' : ''}`}
              className={clsx(
                'flex-1 h-full flex flex-col justify-end rounded-t-[3px] relative group transition-opacity',
                !ativo && sel && 'opacity-70 hover:opacity-100'
              )}
            >
              <span className={clsx(
                'absolute -top-4 left-1/2 -translate-x-1/2 text-[9.5px] num whitespace-nowrap',
                ativo ? 'text-gap-navy font-semibold' : 'text-gap-muted hidden sm:block'
              )}>
                {moneyShort(m.total)}
              </span>
              <span
                className={clsx(
                  'w-full flex flex-col-reverse overflow-hidden rounded-t-[3px]',
                  m.aberta && 'outline outline-1 outline-dashed outline-gap-blue outline-offset-1',
                  m.incompleta && 'outline outline-1 outline-dashed outline-[#f59e0b] outline-offset-1',
                  ativo && 'ring-2 ring-gap-blue ring-offset-1'
                )}
                style={{ height: h(m.total), opacity: m.aberta ? 0.55 : 1 }}
              >
                {m.partes.map((p, j) => (
                  <span key={j} style={{ height: `${(Math.max(0, p.cents) / Math.max(1, m.total)) * 100}%`, background: p.cor }} />
                ))}
              </span>
              <span className={clsx(
                'absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap',
                ativo ? 'text-gap-navy font-semibold' : 'text-gap-muted',
                !ativo && i % passo !== (meses.length - 1) % passo && 'hidden sm:block'
              )}>
                {monthLabel(m.month)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
