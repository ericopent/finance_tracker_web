import { Trash2, Lock, Repeat, PencilLine, TrendingUp, Check, X, HelpCircle } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import QuickEntry from '../components/QuickEntry'

import { useMonthView, useDeleteTxn, useConfirmRecurring, useDismissRecurring } from '../lib/api'
import { GAP, money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'

/** Barra de composicao do mes: travado -> lancado -> projetado. */
function Composicao({ v }) {
  const partes = [
    { label: 'Parcelas', cents: v.installments_cents, cor: GAP.navy, icon: Lock },
    { label: 'Recorrente', cents: v.subscriptions_cents + v.fixed_outflow_cents, cor: GAP.blue, icon: Repeat },
    { label: 'Lançado', cents: v.logged_cents, cor: '#8b5cf6', icon: PencilLine },
    { label: 'Projetado', cents: v.remaining.p50, cor: '#cbd5e1', icon: TrendingUp },
  ]
  const total = Math.max(1, partes.reduce((a, p) => a + p.cents, 0))
  return (
    <div className="gap-card p-3.5">
      <div className="flex h-7 rounded-md overflow-hidden border border-gap-border">
        {partes.map((p) => (
          <div
            key={p.label}
            style={{ width: `${(p.cents / total) * 100}%`, background: p.cor }}
            title={`${p.label}: ${money(p.cents)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
        {partes.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.cor }} />
            <span className="text-gap-muted">{p.label}</span>
            <span className="num font-semibold">{money(p.cents)}</span>
          </div>
        ))}
        <div className="ml-auto text-[11.5px] text-gap-muted">
          dia <b className="num text-gap-navy">{v.day}</b> de {v.days_in_month} ·{' '}
          <b className="num text-gap-navy">{brNum(v.elapsed_share * 100, 0)}%</b> do gasto típico do mês já deveria ter ocorrido
        </div>
      </div>
    </div>
  )
}

/**
 * Faixa p10/p50/p90 do total do mes.
 *
 * Feita em CSS, nao em Plotly: a biblioteca custa ~1,4 MB gzipados e isso e a
 * PRIMEIRA tela que abre no celular. Tres barras horizontais nao justificam
 * baixar um motor de graficos no 4G. Plotly fica pro Fluxo de Caixa, onde tem
 * serie temporal de verdade e o download se paga.
 */
function Faixa({ v }) {
  const base = v.baseline_cents + v.installments_cents + v.subscriptions_cents + v.fixed_outflow_cents
  const pts = [
    { l: 'Otimista', tag: 'p10', c: v.total.p10, cor: GAP.green },
    { l: 'Central', tag: 'p50', c: v.total.p50, cor: GAP.blue },
    { l: 'Pessimista', tag: 'p90', c: v.total.p90, cor: GAP.red },
  ]
  const max = Math.max(...pts.map((p) => p.c), base) * 1.08 || 1
  return (
    <div className="gap-card p-3.5">
      <div className="text-[12px] font-semibold text-gap-navy mb-3">Fatura estimada do mês</div>
      <div className="relative flex flex-col gap-2">
        {/* marca do gasto tipico, pra faixa ter referencia */}
        <div
          className="absolute top-0 bottom-0 border-l border-dashed border-gap-muted/60 pointer-events-none"
          style={{ left: `${(base / max) * 100}%` }}
        >
          <span className="absolute -top-2.5 left-1 text-[9.5px] text-gap-muted whitespace-nowrap">
            típico {moneyShort(base)}
          </span>
        </div>
        {pts.map((p) => (
          <div key={p.tag} className="flex items-center gap-2">
            <div className="w-[74px] shrink-0 text-[11px] text-gap-muted">
              {p.l} <span className="opacity-60">{p.tag}</span>
            </div>
            <div className="flex-1 h-6 bg-gap-soft rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm transition-[width] duration-500"
                style={{ width: `${Math.max(1, (p.c / max) * 100)}%`, background: p.cor }}
              />
            </div>
            <div className="w-[92px] shrink-0 text-right num text-[12px] font-semibold">{money(p.c)}</div>
          </div>
        ))}
      </div>
      <div className="text-[10.5px] text-gap-muted mt-2.5">
        Faixa de 80%: em 8 de cada 10 meses parecidos, o total cai entre{' '}
        <b>{moneyShort(v.total.p10)}</b> e <b>{moneyShort(v.total.p90)}</b>.
      </div>
    </div>
  )
}

/**
 * Candidatos a recorrente.
 *
 * A regra estrita (5 de 6 meses, cv<15%) e cega pra assinatura nova — CLAUDE.AI
 * a R$ 582/mes so tem 4 meses de historico e ficaria fora do travado. Em vez de
 * afrouxar a regra e travar coisa que nao e fixa, pergunta.
 */
function Candidatos({ itens }) {
  const ok = useConfirmRecurring()
  const no = useDismissRecurring()
  if (!itens?.length) return null
  return (
    <div className="gap-card p-3.5 border-l-4 border-l-[#f59e0b]">
      <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
        <HelpCircle size={13} className="text-[#f59e0b]" />
        Isso é recorrente?
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        Aparece com regularidade mas ainda não tem histórico suficiente pra entrar
        sozinho no travado. Confirmando, passa a contar todo mês.
      </div>
      <div className="flex flex-col gap-1.5">
        {itens.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-[12.5px] border border-gap-border rounded-md px-2.5 py-1.5">
            <span className="truncate flex-1" title={c.label}>{c.label}</span>
            <span className="text-gap-muted text-[11px] whitespace-nowrap">
              {c.months_seen}/6 meses · cv {brNum(c.cv, 2)}
            </span>
            <span className="num font-semibold whitespace-nowrap">{money(c.cents)}</span>
            <button
              className="text-gap-green hover:bg-gap-green/10 rounded p-1 transition-colors"
              title="é recorrente"
              onClick={() => ok.mutate({ label: c.label, key: c.key, cents: c.cents, category: c.category ?? null })}
            ><Check size={14} /></button>
            <button
              className="text-gap-muted hover:text-gap-red hover:bg-gap-red/10 rounded p-1 transition-colors"
              title="não é — parar de sugerir"
              onClick={() => no.mutate(c.key)}
            ><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MesCorrentePage() {
  const { data: v, isLoading, error } = useMonthView()
  const del = useDeleteTxn()

  if (isLoading) return <div className="p-6 text-gap-muted text-sm">carregando do GitHub…</div>
  if (error) return <div className="p-6 text-gap-red text-sm">erro: {String(error.message ?? error)}</div>
  if (!v) return null

  const manuais = v.logged
  const travado = v.installments_cents + v.subscriptions_cents + v.fixed_outflow_cents

  return (
    <div className="p-5 max-w-[1180px] mx-auto">
      <PageHeader
        title={`Mês corrente — ${monthLabel(v.month)}`}
        subtitle={`Travado do dia 1. Última fatura importada: ${monthLabel(v.last_statement)} · parcelas projetadas a partir dela.`}
      />

      <KpiGrid
        items={[
          { label: 'Já travado', value: money(travado), sub: 'parcelas + recorrentes', tone: 'pos' },
          { label: 'Lançado por você', value: money(v.logged_cents), sub: `${v.logged_count} lançamento${v.logged_count === 1 ? '' : 's'}` },
          { label: 'Falta gastar (p50)', value: money(v.remaining.p50), sub: `${money(v.remaining.p10)} – ${money(v.remaining.p90)}` },
          { label: 'Total do mês', value: money(v.total.p50), sub: `faixa 80%: ${moneyShort(v.total.p10)} – ${moneyShort(v.total.p90)}`, tone: 'pos' },
          { label: 'Sobra estimada', value: moneySigned(v.net.p50), sub: `renda ${moneyShort(v.income_cents)}`, tone: v.net.p50 >= 0 ? 'neg' : 'pos' },
        ]}
      />

      <div className="mt-4"><QuickEntry /></div>
      <div className="mt-3"><Composicao v={v} /></div>
      {v.candidates?.length > 0 && <div className="mt-3"><Candidatos itens={v.candidates} /></div>}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div className="gap-card p-3.5">
          <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
            <Lock size={13} className="text-gap-muted" />
            Parcelas caindo em {monthLabel(v.month)}
            <span className="ml-auto num text-gap-muted font-normal">{money(v.installments_cents)}</span>
          </div>
          <GapTable
            wrap maxHeight={300}
            empty="nenhuma parcela este mês"
            columns={[
              { key: 'label', label: 'Contrato', align: 'left', fmt: (x) => <span className="truncate block max-w-[230px]" title={x}>{x}</span> },
              { key: 'number', label: 'Parcela', fmt: (_, r) => `${r.number}/${r.total}` },
              { key: 'remaining', label: 'Restam', fmt: (x) => `${x}` },
              { key: 'cents', label: 'Valor', align: 'right', fmt: money },
            ]}
            rows={v.installments}
          />
        </div>

        <div className="gap-card p-3.5">
          <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
            <Repeat size={13} className="text-gap-muted" />
            Recorrentes
            <span className="ml-auto num text-gap-muted font-normal">
              {money(v.subscriptions_cents + v.fixed_outflow_cents)}
            </span>
          </div>
          <GapTable
            wrap maxHeight={300}
            empty="nada recorrente detectado"
            columns={[
              { key: 'label', label: 'Item', align: 'left', fmt: (x) => <span className="truncate block max-w-[210px]" title={x}>{x}</span> },
              { key: 'declared', label: 'Origem', fmt: (d, r) => d ? 'cadastrado' : `${r.months_seen}/6 meses` },
              { key: 'cents', label: 'Valor', align: 'right', fmt: money },
            ]}
            rows={v.subscriptions}
          />
        </div>
      </div>

      <div className="mt-4"><Faixa v={v} /></div>

      <div className="mt-4 gap-card p-3.5">
        <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
          <PencilLine size={13} className="text-gap-muted" />
          Lançados por você em {monthLabel(v.month)}
          <span className="ml-auto num text-gap-muted font-normal">{money(v.logged_cents)}</span>
        </div>
        <GapTable
          wrap maxHeight={360}
          empty="nada lançado ainda — use a linha acima"
          columns={[
            { key: 'date', label: 'Data', fmt: (x) => x?.slice(8, 10) + '/' + x?.slice(5, 7) },
            { key: 'desc', label: 'Onde', align: 'left' },
            { key: 'cat', label: 'Categoria', fmt: (x, r) => x ? `${x}${r.sub ? ` · ${r.sub}` : ''}` : '—' },
            { key: 'cents', label: 'Valor', align: 'right', fmt: money },
            {
              key: 'id', label: '', fmt: (id) => (
                <button
                  onClick={() => del.mutate(id)}
                  className="text-gap-muted hover:text-gap-red transition-colors"
                  title="apagar"
                ><Trash2 size={13} /></button>
              ),
            },
          ]}
          rows={manuais}
        />
      </div>
    </div>
  )
}
