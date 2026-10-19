import { useState } from 'react'
import clsx from 'clsx'
import { Scissors, Repeat, Lock, TrendingUp, PartyPopper, AlertTriangle, Loader2, Target, Zap } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import { useLevers, useCancelRecurring } from '../lib/api'
import { monthAdd } from '../lib/engine'
import { GAP, money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'

const dm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')
/** Dinheiro em celula de tabela: nunca quebra em duas linhas. */
const R = (c, dec) => <span className="whitespace-nowrap">{money(c, dec)}</span>
// colorSign do GapTable so colore string; aqui o sinal vem com a cor junto
const RS = (c, dec) => <span className={clsx('whitespace-nowrap', c > 0 ? 'var-pos' : c < 0 ? 'var-neg' : '')}>{moneySigned(c, dec)}</span>

function Card({ icon: Icon, cor = GAP.blue, titulo, total, sub, children }) {
  return (
    <div className="gap-card p-3.5 mt-4 border-l-4" style={{ borderLeftColor: cor }}>
      <div className="flex items-baseline gap-1.5 mb-0.5">
        <Icon size={13} className="shrink-0 self-center" style={{ color: cor }} />
        <span className="text-[12.5px] font-semibold text-gap-navy">{titulo}</span>
        {total != null && (
          <span className="ml-auto num text-[13px] font-bold text-gap-navy whitespace-nowrap">
            {money(total, 0)}<span className="text-[10.5px] text-gap-muted font-normal">/mês</span>
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-gap-muted mb-2.5">{sub}</div>}
      {children}
    </div>
  )
}

/**
 * Assinaturas no cartao, com o botao de cancelar.
 *
 * O mesmo `useCancelRecurring` da aba Mes: grava a lapide no config, o detector
 * cala, e a projecao para de contar. Dois toques, pra o dedo nao cancelar sem querer.
 */
function Assinaturas({ v }) {
  const cancelar = useCancelRecurring()
  const [busy, setBusy] = useState(null)
  const [confirmar, setConfirmar] = useState(null)
  const anual = v.assinaturas_cents * 12

  const acao = async (a) => {
    if (confirmar !== a.key) { setConfirmar(a.key); return }
    setBusy(a.key); setConfirmar(null)
    try { await cancelar.mutateAsync({ key: a.key, label: a.label, category: a.category, cents: a.cents }) }
    catch { /* abaixo */ } finally { setBusy(null) }
  }

  return (
    <Card
      icon={Repeat} titulo="Assinaturas no cartão" total={v.assinaturas_cents}
      sub={<>Cobradas todo mês, valor fixo. Dá pra cancelar hoje. São <b>{money(anual, 0)} por ano</b>.</>}
    >
      <GapTable
        wrap maxHeight={320} empty="nenhuma assinatura detectada"
        columns={[
          { key: 'label', label: 'Item', align: 'left', fmt: (x, r) => <span className={clsx('truncate block max-w-[200px]', r.reembolsado && 'line-through text-gap-muted')} title={x}>{x}</span> },
          { key: 'declared', label: 'Origem', mobile: false, fmt: (d, r) => (d ? 'cadastrado' : `${r.months_seen ?? '—'}/6 meses`) },
          { key: 'ultimo', label: 'Último', mobile: false, fmt: (m) => (m ? monthLabel(m) : '—') },
          { key: 'cents', label: 'Mês', align: 'right', fmt: (c) => R(c) },
          { key: 'anual', label: 'Ano', align: 'right', mobile: false, fmt: (_, r) => <span className="text-gap-muted">{moneyShort(r.cents * 12)}</span> },
          {
            key: 'acao', label: '', align: 'right',
            fmt: (_, r) => busy === r.key
              ? <Loader2 size={13} className="animate-spin text-gap-blue inline" />
              : r.reembolsado ? <span className="text-[10.5px] text-gap-green">empresa paga</span> : (
                <button
                  className={clsx('text-[10.5px] rounded px-1.5 py-0.5 border whitespace-nowrap',
                    confirmar === r.key ? 'border-gap-red bg-gap-red text-white font-semibold' : 'border-gap-border text-gap-muted hover:border-gap-red hover:text-gap-red')}
                  onClick={() => acao(r)} disabled={!!busy}
                >{confirmar === r.key ? 'confirmar' : 'cancelei'}</button>
              ),
          },
        ]}
        rows={v.assinaturas.map((a) => ({ ...a, id: a.key }))}
      />
      {cancelar.isError && (
        <div className="text-[11px] text-gap-red mt-1.5">não consegui salvar: {String(cancelar.error?.message ?? cancelar.error)}</div>
      )}
      {v.foraDoCartao.length > 0 && (
        <div className="mt-2.5 text-[11.5px] text-gap-muted">
          Fora do cartão, mais <b className="text-gap-navy num">{money(v.fora_cents, 0)}/mês</b> de fixos:{' '}
          {v.foraDoCartao.map((f) => `${f.label} ${money(f.cents, 0)}`).join(' · ')}. Não entram na fatura, saem do mesmo bolso.
        </div>
      )}
    </Card>
  )
}

/** Quase todo mes, valor que varia: credito de API, farmacia, Uber. */
function Frequentes({ v }) {
  if (!v.frequentes.length) return null
  return (
    <Card
      icon={Zap} cor="#f59e0b" titulo="Gastos quase mensais de valor variável" total={v.frequentes_cents}
      sub="Não são assinatura — o valor muda — mas aparecem em quase toda fatura. É onde um hábito muda a conta: cada um aqui é uma decisão por mês, não uma por ano."
    >
      <GapTable
        wrap maxHeight={360}
        columns={[
          { key: 'label', label: 'Lojista', align: 'left', fmt: (x) => <span className="truncate block max-w-[190px]" title={x}>{x}</span> },
          { key: 'category', label: 'Categoria', mobile: false, fmt: (c) => c ?? '—' },
          { key: 'meses', label: 'Freq.', fmt: (m, r) => `${m}/${r.de}` },
          { key: 'faixa', label: 'Faixa', mobile: false, fmt: (_, r) => <span className="text-gap-muted whitespace-nowrap">{moneyShort(r.min)}–{moneyShort(r.max)}</span> },
          { key: 'cents', label: 'Média 6', align: 'right', fmt: (c) => <b>{R(c, 0)}</b> },
          { key: 'media3', label: 'Últimas 3', align: 'right', fmt: (c) => R(c, 0) },
        ]}
        rows={v.frequentes.map((f) => ({ ...f, id: f.key }))}
      />
    </Card>
  )
}

/**
 * Parcelas: o unico corte que acontece sozinho. A pergunta util e QUANDO.
 */
function Parcelas({ v }) {
  const r = v.runoff
  const max = Math.max(1, ...r.map((x) => x.cents))
  const quedas = r.filter((x) => x.alivio > 0)
  const em3 = r[3] ? r[0].cents - r[3].cents : 0
  const em6 = r[6] ? r[0].cents - r[6].cents : 0
  const zero = r.find((x) => x.cents === 0)

  return (
    <Card
      icon={Lock} cor={GAP.navy} titulo={`Parcelas na fatura de ${monthLabel(v.fatura_alvo)}`} total={v.parcelas_alvo}
      sub={<>
        Acabam sozinhas. Sem fazer nada, em 3 meses a fatura cai <b className="text-gap-green">{money(em3, 0)}</b>,
        em 6 meses <b className="text-gap-green">{money(em6, 0)}</b>
        {zero ? <>, e em <b>{monthLabel(zero.month)}</b> não sobra parcela nenhuma</> : null}.
        Cada compra parcelada nova empurra isso pra frente.
      </>}
    >
      <div className="flex items-end gap-[3px] sm:gap-1.5 h-[80px] mt-1">
        {r.map((x, i) => (
          <div key={x.month} className="flex-1 h-full flex flex-col justify-end items-center" title={`${monthLabel(x.month)}: ${money(x.cents)} (${x.count})`}>
            <span className={clsx('text-[9px] num mb-0.5 text-gap-muted', i % 3 !== 0 && 'hidden sm:block')}>{x.cents ? moneyShort(x.cents) : ''}</span>
            <span className="w-full rounded-t-[2px]" style={{ height: `${(x.cents / max) * 72}%`, minHeight: x.cents ? 2 : 0, background: i === 0 ? GAP.navy : '#5b7aa0' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] sm:gap-1.5 mt-1 mb-3">
        {r.map((x, i) => (
          <span key={x.month} className={clsx('flex-1 text-center text-[9.5px] text-gap-muted', i % 3 !== 0 && 'invisible sm:visible')}>{monthLabel(x.month)}</span>
        ))}
      </div>

      {quedas.length > 0 && (
        <div className="text-[11.5px] mb-2.5 flex flex-col gap-0.5">
          {quedas.slice(0, 6).map((x) => (
            <div key={x.month} className="flex items-baseline gap-2">
              <span className="w-[48px] shrink-0 text-gap-muted">{monthLabel(x.month)}</span>
              <span className="num text-gap-green font-semibold w-[64px] shrink-0">−{money(x.alivio, 0)}</span>
              <span className="truncate text-gap-muted">{x.acabam.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      <GapTable
        wrap maxHeight={300} empty="nenhuma parcela em aberto"
        columns={[
          { key: 'label', label: 'Contrato', align: 'left', fmt: (x) => <span className="truncate block max-w-[200px]" title={x}>{x}</span> },
          { key: 'number', label: 'Parcela', fmt: (_, c) => `${c.number}/${c.total}` },
          { key: 'cents', label: 'Valor', align: 'right', fmt: (c) => R(c) },
          { key: 'termina', label: 'Última em', fmt: (m) => monthLabel(m) },
          { key: 'falta', label: 'Ainda deve', align: 'right', mobile: false, fmt: (_, c) => <span className="text-gap-muted">{moneyShort(c.cents * (c.restam + 1))}</span> },
        ]}
        rows={v.contratos.map((c) => ({ ...c, id: `${c.label}|${c.cents}|${c.number}` }))}
      />
    </Card>
  )
}

/** Variavel por categoria: ultimas 3 fechadas contra a mediana de 12. */
function Categorias({ v }) {
  const linhas = v.categorias.filter((c) => c.media3 > 0 || c.med12 > 0)
  if (!linhas.length) return null
  const acima = linhas.filter((c) => c.delta > 0)
  const somaAcima = acima.reduce((a, c) => a + c.delta, 0)
  const temMeta = linhas.some((c) => c.meta != null)
  return (
    <Card
      icon={TrendingUp} cor={GAP.red} titulo="Dia a dia por categoria: últimas 3 faturas vs o seu normal" total={somaAcima > 0 ? somaAcima : null}
      sub={<>
        Só o <b>dia a dia</b> (sem parcela, sem recorrente). "Normal" é a mediana das últimas 12 faturas fechadas.
        {acima.length ? <> O que está acima soma <b className="text-gap-red">{money(somaAcima, 0)}/mês</b> — é o corte que não exige cancelar nada, só voltar ao que você já fazia.</> : ' Nada acima do normal agora.'}
      </>}
    >
      <GapTable
        wrap maxHeight={420}
        columns={[
          { key: 'cat', label: 'Categoria', align: 'left' },
          { key: 'media3', label: 'Últimas 3', align: 'right', fmt: (c) => <b>{R(c, 0)}</b> },
          { key: 'med12', label: 'Normal', align: 'right', fmt: (c) => R(c, 0) },
          { key: 'delta', label: 'Diferença', align: 'right', colorSign: true, fmt: (c) => RS(c, 0) },
          ...(temMeta ? [
            { key: 'meta', label: 'Meta', align: 'right', mobile: false, fmt: (c) => (c != null ? money(c, 0) : '—') },
            { key: 'vs_meta', label: 'vs meta', align: 'right', colorSign: true, fmt: (c) => (c != null ? RS(c, 0) : '—') },
          ] : []),
        ]}
        rows={linhas.map((c) => ({ ...c, id: c.cat }))}
        rowClass={(r) => (r.delta > 0 ? '[&>td]:!bg-[#fff5f4]' : undefined)}
      />
    </Card>
  )
}

function LojistasAlta({ v }) {
  if (!v.lojistas_alta.length) return null
  const soma = v.lojistas_alta.reduce((a, l) => a + l.delta, 0)
  return (
    <Card
      icon={TrendingUp} cor="#8b5cf6" titulo="Lojistas que subiram" total={soma}
      sub="Média das últimas 3 faturas contra as 9 anteriores, só no dia a dia. Quem apareceu do nada ou dobrou."
    >
      <GapTable
        wrap maxHeight={320}
        columns={[
          { key: 'label', label: 'Lojista', align: 'left', fmt: (x) => <span className="truncate block max-w-[200px]" title={x}>{x}</span> },
          { key: 'category', label: 'Categoria', mobile: false, fmt: (c) => c ?? '—' },
          { key: 'antes', label: 'Antes', align: 'right', fmt: (c) => R(c, 0) },
          { key: 'media3', label: 'Agora', align: 'right', fmt: (c) => <b>{R(c, 0)}</b> },
          { key: 'delta', label: 'Diferença', align: 'right', colorSign: true, fmt: (c) => RS(c, 0) },
        ]}
        rows={v.lojistas_alta.map((l) => ({ ...l, id: l.key }))}
      />
    </Card>
  )
}

function Eventos({ v }) {
  if (!v.ultima) return null
  return (
    <Card
      icon={PartyPopper} cor="#8b5cf6" titulo={`O que inflou a fatura de ${monthLabel(v.ultima)}`} total={v.eventos_cents || null}
      sub={v.eventos.length
        ? <>Compras únicas de R$ 500+ ou marcadas como evento. Sem elas, {monthLabel(v.ultima)} teria sido <b>{money(v.ultima_cents - v.eventos_cents, 0)}</b> em vez de {money(v.ultima_cents, 0)}. Não são corte — são o que explica o mês.</>
        : `Nenhuma compra única grande em ${monthLabel(v.ultima)}.`}
    >
      {v.eventos.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px] py-[3px] border-b border-[#f0f4f8] last:border-0">
          <span className="text-gap-muted num w-[38px] shrink-0">{dm(e.date)}</span>
          <span className="truncate flex-1">{e.desc}</span>
          <span className="hidden sm:inline text-gap-muted text-[10.5px]">{e.cat ?? ''}</span>
          {e.event && <span className="text-[9.5px] uppercase text-[#8b5cf6] border border-[#8b5cf6]/40 rounded px-1">evento</span>}
          <span className="num font-semibold tabular-nums">{money(e.cents)}</span>
        </div>
      ))}
    </Card>
  )
}

export default function CortarPage() {
  const { data: v, isLoading, error } = useLevers()

  if (error) {
    return (
      <div className="p-5">
        <div className="gap-card p-4 max-w-[560px]">
          <div className="text-[14px] font-bold text-gap-red mb-1">Não consegui calcular</div>
          <div className="text-[12.5px] whitespace-pre-line leading-relaxed">{String(error.message ?? error)}</div>
        </div>
      </div>
    )
  }
  if (!v) return <div className="p-6 text-gap-muted text-sm">{isLoading ? 'carregando do GitHub…' : 'preparando…'}</div>

  const em6 = v.runoff[6] ? v.runoff[0].cents - v.runoff[6].cents : 0
  const acima = v.categorias.filter((c) => c.delta > 0).reduce((a, c) => a + c.delta, 0)
  const aoAlcance = v.assinaturas_cents + acima
  const mes6 = monthAdd(v.fatura_alvo, 6)

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Cortar"
        subtitle="O que faz a fatura cair, do maior pro menor, com o tamanho de cada um."
      />

      <KpiGrid
        items={[
          { label: `Última fechada · ${monthLabel(v.ultima)}`, value: money(v.ultima_cents), tone: 'pos' },
          { label: 'Média 3 fechadas', value: money(v.nivel3), sub: `mediana 12: ${moneyShort(v.nivel12)}` },
          ...(v.meta ? [
            { label: 'Teto da fatura', value: money(v.teto), sub: `meta ${moneyShort(v.meta)} − ${moneyShort(v.fora_cents)} fora do cartão` },
            { label: v.gap > 0 ? 'Falta cortar' : 'Folga', value: money(Math.abs(v.gap)), tone: v.gap > 0 ? 'pos' : 'neg', sub: 'por mês, vs média 3' },
          ] : []),
        ]}
      />

      {v.incompletas.length > 0 && (
        <div className="gap-card p-3.5 mt-4 border-l-4 border-l-[#f59e0b]">
          <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-[#f59e0b]" />
            {v.incompletas.map(monthLabel).join(', ')} fora das contas: extrato pela metade
          </div>
          <div className="text-[11.5px] text-gap-muted">
            Importada ainda aberta e nunca reimportada. Reimporte a fatura fechada na aba Importar e ela volta pras médias.
          </div>
        </div>
      )}

      {/* a conta de fechamento primeiro: e a frase que a tela existe pra dizer */}
      <div className="gap-card p-3.5 mt-4 border-l-4 border-l-gap-green">
        <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
          <Target size={14} className="text-gap-green" />
          {v.meta && v.gap > 0
            ? <>Pra fatura caber em {moneyShort(v.teto)}, faltam {money(v.gap, 0)} por mês</>
            : v.meta ? <>A média já cabe no teto de {moneyShort(v.teto)}</> : <>Sem meta definida — defina na aba Mês</>}
        </div>
        <div className="text-[11.5px] text-gap-muted leading-relaxed">
          {v.meta && <>A meta de {moneyShort(v.meta)} é do mês inteiro; tirando {moneyShort(v.fora_cents)} que não passam no cartão, sobram {moneyShort(v.teto)} pra fatura.{' '}</>}
          Parcelas devolvem <b className="text-gap-green">{money(em6, 0)}/mês</b> sozinhas até {monthLabel(mes6)}.
          Assinaturas canceláveis: <b>{money(v.assinaturas_cents, 0)}/mês</b>.
          Dia a dia acima do seu normal: <b>{money(acima, 0)}/mês</b>.
          Gastos quase mensais de valor variável (hábito, não contrato): <b>{money(v.frequentes_cents, 0)}/mês</b>.
          {v.meta && v.gap > 0 && (
            aoAlcance + em6 >= v.gap
              ? <> Parcelas + assinaturas + voltar ao normal já cobrem a meta, sem mexer em hábito.</>
              : <> Mesmo com parcelas, assinaturas e voltar ao normal, ainda faltam <b className="text-gap-red">{money(v.gap - aoAlcance - em6, 0)}</b> — esses têm que sair dos frequentes.</>
          )}
        </div>
      </div>

      <Assinaturas v={v} />
      <Frequentes v={v} />
      <Parcelas v={v} />
      <Categorias v={v} />
      <LojistasAlta v={v} />
      <Eventos v={v} />

      <div className="text-[10.5px] text-gap-muted mt-3 flex items-start gap-1.5">
        <Scissors size={12} className="shrink-0 mt-0.5" />
        <span>
          Nada aqui decide por você. É a lista do que move o ponteiro, com o tamanho de cada um,
          pra escolher onde cortar sabendo quanto rende. "Fechada" = ciclo terminou; a fatura de{' '}
          {monthLabel(v.fatura_alvo)} ainda está aberta e não entra nas médias.
        </span>
      </div>
    </div>
  )
}
