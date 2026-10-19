import { useState, useMemo, useEffect } from 'react'
import clsx from 'clsx'
import { History, Search, ChevronDown, ChevronUp, AlertTriangle, Lock, Repeat, X, PartyPopper } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import StackBars from '../components/StackBars'
import { useHistory } from '../lib/api'
import { baselinePorCategoria, lojistaHistorico } from '../lib/insights'
import { GAP, money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'

/*
 * Cores dos tres blocos — as MESMAS da barra de composicao do Mes Corrente,
 * pra "parcelas" ter a mesma cor nas duas telas.
 */
const COR = { parcelas: GAP.navy, recorrentes: GAP.blue, variavel: '#a9d4f2' }
const NOME = { parcelas: 'Parcelas', recorrentes: 'Recorrentes', variavel: 'Dia a dia' }

function Chip({ cor, children }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] text-gap-muted">
      <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: cor }} />
      {children}
    </span>
  )
}

function Bloco({ bloco }) {
  const Icon = bloco === 'parcelas' ? Lock : bloco === 'recorrentes' ? Repeat : null
  if (!Icon) return null
  return <Icon size={11} className="inline text-gap-muted" title={NOME[bloco]} />
}

/** '2026-07-30' -> '30/07' */
const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

/**
 * Fatura fechada que o extrato nao cobre ate o fim do ciclo.
 *
 * Sem este aviso, out/26 (56 linhas, R$ 7,9k) parecia o melhor mes do ano. Nao
 * era: foi importada em 08/09 ainda aberta e nunca reimportada. O numero mente
 * em silencio, e a media que o resto do app usa vai junto.
 */
function Incompletas({ itens }) {
  if (!itens?.length) return null
  return (
    <div className="gap-card p-3.5 mt-4 border-l-4 border-l-[#f59e0b]">
      <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
        <AlertTriangle size={14} className="text-[#f59e0b]" />
        {itens.length === 1 ? 'Uma fatura' : `${itens.length} faturas`} com extrato pela metade
      </div>
      <div className="text-[11.5px] text-gap-muted">
        {itens.map((m) => (
          <div key={m.month}>
            <b className="text-gap-navy">{monthLabel(m.month)}</b>: importada
            {m.importada_em ? ` em ${dm(m.importada_em)}` : ''} com lançamentos até <b>{dm(m.ultima_data)}</b>,
            mas o ciclo foi até {dm(m.ciclo_fim)}. Tem {m.n} linhas e {moneyShort(m.total)} — um mês normal tem o dobro.
          </div>
        ))}
        <div className="mt-1">
          {itens.length === 1 ? 'Ela fica' : 'Elas ficam'} <b>fora das médias</b> até você reimportar a fatura fechada na aba Importar.
        </div>
      </div>
    </div>
  )
}

/** Categorias do mes selecionado, com o lojista por dentro ao clicar. */
function Categorias({ m, base, mesesBase, onLojista }) {
  const [aberta, setAberta] = useState(null)
  const max = Math.max(1, ...m.categorias.map((c) => Math.max(c.cents, base.get(c.cat) ?? 0)))

  return (
    <div className="gap-card p-3.5 mt-4">
      <div className="text-[12px] font-semibold text-gap-navy mb-0.5">
        Por categoria · {monthLabel(m.month)}
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        Barra cheia = este mês, dividida em <Chip cor={COR.parcelas}>parcelas</Chip>{' '}
        <Chip cor={COR.recorrentes}>recorrentes</Chip> <Chip cor={COR.variavel}>dia a dia</Chip>.
        O traço é a média das {mesesBase} faturas fechadas anteriores. Toque na categoria pra abrir os lojistas.
      </div>

      <div className="flex items-center text-[10.5px] text-gap-muted mb-1">
        <span className="w-[112px] sm:w-[150px] shrink-0">categoria</span>
        <span className="flex-1" />
        <span className="w-[68px] text-right">este mês</span>
        <span className="hidden sm:block w-[68px] text-right">média</span>
        <span className="w-[64px] text-right">vs média</span>
      </div>

      {m.categorias.map((c) => {
        const b = base.get(c.cat) ?? 0
        const d = c.cents - b
        const open = aberta === c.cat
        const lojistas = m.lojistas.filter((l) => l.cat === c.cat)
        return (
          <div key={c.cat}>
            <button
              className={clsx('w-full flex items-center text-[12px] py-[5px] text-left rounded hover:bg-gap-soft', open && 'bg-gap-soft')}
              onClick={() => setAberta(open ? null : c.cat)}
            >
              <span className="w-[112px] sm:w-[150px] shrink-0 truncate flex items-center gap-1" title={c.cat}>
                {open ? <ChevronUp size={11} className="text-gap-muted shrink-0" /> : <ChevronDown size={11} className="text-gap-muted shrink-0" />}
                {c.cat}
              </span>
              <span className="flex-1 px-2 relative">
                <span className="flex h-[12px] rounded-sm overflow-hidden" style={{ width: `${(Math.max(0, c.cents) / max) * 100}%` }}>
                  <span style={{ flex: Math.max(0, c.parcelas), background: COR.parcelas }} />
                  <span style={{ flex: Math.max(0, c.recorrentes), background: COR.recorrentes }} />
                  <span style={{ flex: Math.max(0, c.variavel), background: COR.variavel }} />
                </span>
                {b > 0 && (
                  <span
                    className="absolute top-[-2px] bottom-[-2px] border-l-2 border-gap-navy/60"
                    // a area da barra tem 8px de padding de cada lado (px-2)
                    style={{ left: `calc(8px + ${(b / max) * 100}% - ${(b / max) * 16}px)` }}
                    title={`média: ${money(b)}`}
                  />
                )}
              </span>
              <span className="w-[68px] text-right num font-semibold tabular-nums">{money(c.cents, 0)}</span>
              <span className="hidden sm:block w-[68px] text-right num text-gap-muted tabular-nums">{b ? money(b, 0) : '—'}</span>
              <span className={clsx('w-[64px] text-right num tabular-nums', d > 0 ? 'text-gap-red' : d < 0 ? 'text-gap-green' : 'text-gap-muted')}>
                {b || c.cents ? moneySigned(d, 0) : '—'}
              </span>
            </button>

            {open && (
              <div className="ml-4 sm:ml-6 mb-2 border-l-2 border-gap-border pl-2.5">
                {lojistas.map((l) => (
                  <button
                    key={l.key}
                    className="w-full flex items-center gap-2 text-[11.5px] py-[3px] text-left hover:bg-gap-soft rounded px-1"
                    onClick={() => onLojista(l.key)}
                    title="ver o histórico deste lojista"
                  >
                    <Bloco bloco={l.bloco} />
                    <span className="truncate flex-1">{l.label}</span>
                    <span className="text-gap-muted text-[10.5px] whitespace-nowrap">
                      {l.n > 1 ? `${l.n}×` : dm(l.txns[0]?.date)}
                      {l.txns[0]?.parcela ? ` · ${l.txns[0].parcela}` : ''}
                    </span>
                    <span className="num font-semibold tabular-nums w-[70px] text-right">{money(l.cents, 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Um lojista ao longo das faturas.
 *
 * E a pergunta "quanto eu gasto com X por mes?" — que nenhuma tela respondia.
 * A busca e por nome; escolheu, aparecem as barras mensais e os lancamentos do
 * mes selecionado.
 */
function Lojista({ meses, sel, busca, setBusca, chave, setChave }) {
  const todos = useMemo(() => {
    const by = new Map()
    for (const m of meses) for (const l of m.lojistas) {
      const g = by.get(l.key) ?? { key: l.key, label: l.label, cat: l.cat, cents: 0, meses: 0 }
      g.cents += l.cents; g.meses++
      if (m.month === meses[meses.length - 1].month) g.label = l.label
      by.set(l.key, g)
    }
    return [...by.values()].sort((a, b) => b.cents - a.cents)
  }, [meses])

  const termo = busca.trim().toUpperCase()
  const sugestoes = termo.length >= 2
    ? todos.filter((l) => l.key.includes(termo) || l.label.toUpperCase().includes(termo)).slice(0, 8)
    : []
  const escolhido = chave ? todos.find((l) => l.key === chave) : null
  const hist = escolhido ? lojistaHistorico(meses, chave) : []
  const fechados = hist.filter((h) => !h.aberta)
  const mediaFech = fechados.length ? fechados.reduce((a, h) => a + h.cents, 0) / fechados.length : 0
  const maxH = Math.max(1, ...hist.map((h) => h.cents))
  const doMes = hist.find((h) => h.month === sel)

  return (
    <div className="gap-card p-3.5 mt-4">
      <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
        <Search size={13} className="text-gap-muted" />
        Um lojista ao longo do tempo
      </div>
      <div className="relative">
        <input
          className="gap-input w-full pr-8 text-base md:text-sm"
          placeholder="uber, openai, farmácia…"
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setChave(null) }}
        />
        {(busca || chave) && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gap-muted hover:text-gap-red p-1"
            onClick={() => { setBusca(''); setChave(null) }} aria-label="limpar"
          ><X size={14} /></button>
        )}
      </div>
      {!chave && sugestoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {sugestoes.map((s) => (
            <button
              key={s.key}
              className="text-[11.5px] border border-gap-border rounded-full px-2.5 py-1 hover:bg-[#eef6fd] hover:border-gap-blue"
              onClick={() => { setChave(s.key); setBusca(s.label) }}
            >
              {s.label} <span className="text-gap-muted">· {moneyShort(s.cents)}</span>
            </button>
          ))}
        </div>
      )}

      {escolhido && (
        <div className="mt-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-gap-muted mb-2">
            <span className="text-[13px] font-semibold text-gap-navy">{escolhido.label}</span>
            {escolhido.cat && <span>{escolhido.cat}</span>}
            <span>em <b className="num text-gap-navy">{escolhido.meses}</b> das {meses.length} faturas</span>
            <span>média <b className="num text-gap-navy">{money(mediaFech, 0)}</b>/mês nas fechadas</span>
          </div>
          <div className="flex items-end gap-[3px] sm:gap-1.5 h-[90px]">
            {hist.map((h) => (
              <div key={h.month} className="flex-1 h-full flex flex-col justify-end items-center" title={`${monthLabel(h.month)}: ${money(h.cents)}`}>
                <span className={clsx('text-[9px] num mb-0.5', h.month === sel ? 'text-gap-navy font-semibold' : 'text-gap-muted hidden sm:block')}>
                  {h.cents ? moneyShort(h.cents) : ''}
                </span>
                <span
                  className={clsx('w-full rounded-t-[2px]', h.month === sel && 'ring-2 ring-gap-blue ring-offset-1')}
                  style={{ height: `${(h.cents / maxH) * 70}%`, minHeight: h.cents ? 2 : 0, background: h.aberta ? '#a9d4f2' : GAP.blue }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-[3px] sm:gap-1.5 mt-1">
            {hist.map((h, i) => (
              <span key={h.month} className={clsx('flex-1 text-center text-[9.5px]', h.month === sel ? 'text-gap-navy font-semibold' : 'text-gap-muted', i % 2 !== (hist.length - 1) % 2 && h.month !== sel && 'invisible sm:visible')}>
                {monthLabel(h.month)}
              </span>
            ))}
          </div>

          {doMes && doMes.txns.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] text-gap-muted mb-1">Lançamentos em {monthLabel(sel)} · {money(doMes.cents)}</div>
              {doMes.txns.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-[11.5px] py-[2px]">
                  <span className="text-gap-muted num w-[38px] shrink-0">{dm(t.date)}</span>
                  <span className="truncate flex-1">{t.desc}</span>
                  {t.parcela && <span className="text-gap-muted text-[10.5px]">{t.parcela}</span>}
                  {t.event && <PartyPopper size={11} className="text-[#8b5cf6]" title="evento" />}
                  <span className="num font-semibold tabular-nums">{money(t.cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function HistoricoPage() {
  const { data: h, isLoading, error } = useHistory(13)
  const [sel, setSel] = useState(null)
  const [busca, setBusca] = useState('')
  const [chave, setChave] = useState(null)

  // abre na ultima fatura FECHADA e completa: e o mes que da pra julgar inteiro
  useEffect(() => {
    if (!h || sel) return
    const fechadas = h.meses.filter((m) => !m.aberta && !m.incompleta)
    setSel((fechadas[fechadas.length - 1] ?? h.meses[h.meses.length - 1])?.month ?? null)
  }, [h]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="p-5">
        <div className="gap-card p-4 max-w-[560px]">
          <div className="text-[14px] font-bold text-gap-red mb-1">Não consegui carregar</div>
          <div className="text-[12.5px] whitespace-pre-line leading-relaxed">{String(error.message ?? error)}</div>
        </div>
      </div>
    )
  }
  if (!h || !sel) {
    return <div className="p-6 text-gap-muted text-sm">{isLoading ? 'carregando do GitHub…' : 'preparando…'}</div>
  }

  const m = h.meses.find((x) => x.month === sel) ?? h.meses[h.meses.length - 1]
  const { base, meses: mesesBase } = baselinePorCategoria(h.meses, m.month)
  // a MESMA base do KPI "vs média": tracejado do grafico e numero do card
  // nao podem ser duas medias diferentes com o mesmo nome
  const baseTotal = [...base.values()].reduce((a, b) => a + b, 0)

  const barras = h.meses.map((x) => ({
    month: x.month, aberta: x.aberta, incompleta: x.incompleta, total: x.total,
    partes: [
      { cents: x.parcelas, cor: COR.parcelas },
      { cents: x.recorrentes, cor: COR.recorrentes },
      { cents: x.variavel, cor: COR.variavel },
    ],
  }))

  const escolherLojista = (key) => {
    const l = m.lojistas.find((x) => x.key === key)
    setChave(key); setBusca(l?.label ?? key)
    document.getElementById('lojista-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Histórico"
        subtitle="Pra onde foi o dinheiro, fatura a fatura. Toque numa barra pra abrir o mês."
      />

      <div className="gap-card p-3.5 pt-6">
        <StackBars meses={barras} sel={m.month} onSel={setSel} linha={baseTotal} rotulo={`média ${mesesBase} ant.`} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10.5px] text-gap-muted">
          <Chip cor={COR.parcelas}>parcelas</Chip>
          <Chip cor={COR.recorrentes}>recorrentes</Chip>
          <Chip cor={COR.variavel}>dia a dia</Chip>
          <span>· tracejado azul = em aberto · tracejado laranja = extrato incompleto</span>
        </div>
      </div>

      <div className="mt-4">
        <KpiGrid
          items={[
            {
              label: `Fatura ${monthLabel(m.month)}${m.aberta ? ' · aberta' : ''}`,
              value: money(m.total), tone: 'pos',
              sub: m.aberta ? 'ainda vai crescer' : `${m.n} lançamentos`,
            },
            { label: 'Parcelas', value: money(m.parcelas), sub: `${brNum((m.parcelas / Math.max(1, m.total)) * 100, 0)}% do total` },
            { label: 'Recorrentes', value: money(m.recorrentes), sub: `${brNum((m.recorrentes / Math.max(1, m.total)) * 100, 0)}% do total` },
            { label: 'Dia a dia', value: money(m.variavel), sub: 'o que responde ao que você faz' },
            {
              label: `vs média ${mesesBase} anteriores`, value: moneySigned(m.total - baseTotal),
              tone: m.total - baseTotal > 0 ? 'pos' : 'neg', sub: `média ${moneyShort(baseTotal)}`,
            },
          ]}
        />
      </div>

      <Incompletas itens={h.incompletas} />

      <Categorias m={m} base={base} mesesBase={mesesBase} onLojista={escolherLojista} />

      <div id="lojista-card">
        <Lojista meses={h.meses} sel={m.month} busca={busca} setBusca={setBusca} chave={chave} setChave={setChave} />
      </div>

      <div className="text-[10.5px] text-gap-muted mt-3 flex items-start gap-1.5">
        <History size={12} className="shrink-0 mt-0.5" />
        <span>
          Mês = fatura (vence dia 5, fecha no último dia útil do mês anterior), que é a única janela
          completa. Pagamento de fatura não entra; estorno entra negativo. "Recorrente" aqui inclui
          o que já foi cancelado — o histórico descreve o que aconteceu, a projeção descreve o que vem.
        </span>
      </div>
    </div>
  )
}
