import { useState } from 'react'
import { AlertTriangle, Wallet } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import FanChart from '../components/FanChart'
import { useCashflow } from '../lib/api'
import { money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'
import { parseMoney } from '../lib/money'

export default function FluxoPage() {
  // saldo de partida: sem ele o grafico so mostra a VARIACAO acumulada, que nao
  // responde "quando eu fico no vermelho"
  const [saldo, setSaldo] = useState('')
  const abertura = parseMoney(saldo) ?? 0
  const [horizonte, setHorizonte] = useState(12)

  const { data: pts, isLoading, error } = useCashflow(horizonte, abertura)

  if (error) {
    return (
      <div className="p-5">
        <div className="gap-card p-4 max-w-[560px]">
          <div className="text-[14px] font-bold text-gap-red mb-1">Não consegui calcular</div>
          <div className="text-[12.5px] whitespace-pre-line">{String(error.message ?? error)}</div>
        </div>
      </div>
    )
  }
  if (!pts) return <div className="p-6 text-gap-muted text-sm">{isLoading ? 'carregando…' : 'preparando…'}</div>

  const saldos = pts.map((p) => ({ month: p.month, p10: p.balance.p10, p50: p.balance.p50, p90: p.balance.p90 }))
  const fim = pts[pts.length - 1]
  const poupancaMes = pts.reduce((a, p) => a + p.net.p50, 0) / pts.length

  // o ponto mais baixo do cenario ruim: a pergunta util nao e "quanto sobra no
  // fim", e "em que mes eu quebro"
  const pior = saldos.reduce((m, s) => (s.p10 < m.p10 ? s : m), saldos[0])
  const primeiroNegativo = saldos.find((s) => s.p50 < 0)
  const primeiroNegativoP10 = saldos.find((s) => s.p10 < 0)

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Fluxo de caixa"
        subtitle="Parcelas já contratadas + recorrentes + gasto variável projetado, contra a renda."
        right={
          <div className="flex items-end gap-2">
            <div>
              <label className="gap-label">Saldo hoje</label>
              <input
                className="gap-input w-[130px] num text-base md:text-sm"
                placeholder="0,00" inputMode="decimal"
                value={saldo} onChange={(e) => setSaldo(e.target.value)}
              />
            </div>
            <div>
              <label className="gap-label">Meses</label>
              <select
                className="gap-input text-base md:text-sm"
                value={horizonte} onChange={(e) => setHorizonte(Number(e.target.value))}
              >
                {[6, 12, 18, 24].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        }
      />

      <KpiGrid
        items={[
          { label: 'Sobra por mês (p50)', value: moneySigned(poupancaMes), tone: poupancaMes >= 0 ? 'neg' : 'pos' },
          { label: `Saldo em ${monthLabel(fim.month)}`, value: money(fim.balance.p50), tone: fim.balance.p50 >= 0 ? 'neg' : 'pos', sub: `${moneyShort(fim.balance.p10)} – ${moneyShort(fim.balance.p90)}` },
          { label: 'Renda mensal', value: money(pts[0].income_cents) },
          { label: 'Travado no 1º mês', value: money(pts[0].installments_cents + pts[0].recurring_cents), sub: 'parcelas + recorrentes', tone: 'pos' },
          { label: 'Variável (p50)', value: money(pts[0].discretionary.p50), sub: `${moneyShort(pts[0].discretionary.p10)} – ${moneyShort(pts[0].discretionary.p90)}` },
        ]}
      />

      {(primeiroNegativo || primeiroNegativoP10) && (
        <div className="gap-card p-3.5 mt-4 border-l-4 border-l-gap-red">
          <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-gap-red" />
            {primeiroNegativo
              ? `No cenário central, o saldo fica negativo em ${monthLabel(primeiroNegativo.month)}.`
              : `No cenário ruim, o saldo fica negativo em ${monthLabel(primeiroNegativoP10.month)}.`}
          </div>
          <div className="text-[11.5px] text-gap-muted">
            Pior ponto do período: <b>{money(pior.p10)}</b> em {monthLabel(pior.month)}.
            {!abertura && ' Informe o saldo de hoje pra isso virar um valor real, não só a variação acumulada.'}
          </div>
        </div>
      )}

      <div className="gap-card p-3.5 mt-4">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-gap-navy mb-1">
          <Wallet size={13} className="text-gap-muted" />
          Saldo projetado {abertura ? '' : '(variação acumulada — informe o saldo de hoje)'}
        </div>
        <div className="text-[11px] text-gap-muted mb-2">
          Faixa = 80% dos cenários. Ela abre com o tempo porque meses ruins se empilham.
        </div>
        <FanChart pontos={saldos} height={250} />
      </div>

      <div className="gap-card p-3.5 mt-4">
        <div className="text-[12px] font-semibold text-gap-navy mb-2">Mês a mês</div>
        <GapTable
          wrap maxHeight={420}
          columns={[
            { key: 'month', label: 'Mês', fmt: (m) => monthLabel(m) },
            { key: 'income_cents', label: 'Renda', align: 'right', fmt: (c) => money(c) },
            { key: 'installments_cents', label: 'Parcelas', align: 'right', fmt: (c) => money(c) },
            { key: 'recurring_cents', label: 'Recorrente', align: 'right', fmt: (c) => money(c) },
            { key: 'd', label: 'Variável (p50)', align: 'right', fmt: (_, r) => money(r.discretionary.p50) },
            { key: 'n', label: 'Sobra (p50)', align: 'right', colorSign: true, fmt: (_, r) => moneySigned(r.net.p50) },
            { key: 'b', label: 'Saldo (p50)', align: 'right', colorSign: true, fmt: (_, r) => moneySigned(r.balance.p50) },
          ]}
          rows={pts.map((p) => ({ ...p, id: p.month }))}
        />
        <div className="text-[10.5px] text-gap-muted mt-2">
          Parcelas caem sozinhas conforme os contratos vencem — em {monthLabel(pts[0].month)} são{' '}
          <b>{money(pts[0].installments_cents)}</b>, e no fim do período{' '}
          <b>{money(fim.installments_cents)}</b>. Isso é dinheiro que volta pro seu bolso sem você fazer nada.
        </div>
      </div>

      <div className="text-[10.5px] text-gap-muted mt-3">
        Sinal de alerta honesto: o variável projetado vem da mediana dos seus últimos 12 meses fechados
        ({money(pts[0].discretionary.p50)}/mês). Se você mudar de hábito, a projeção só percebe depois
        que o histórico mudar — ela é âncora, não bola de cristal.
      </div>
    </div>
  )
}
