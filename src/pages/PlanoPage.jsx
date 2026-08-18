import { useState, useEffect } from 'react'
import { Target, AlertTriangle, Check, Loader2, Save } from 'lucide-react'
import clsx from 'clsx'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import FanChart from '../components/FanChart'
import { useCashflow, useDataset, useSetPlan } from '../lib/api'
import { goalPlan, monthAdd, monthDiff } from '../lib/engine'
import { money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'
import { parseMoney, todayISO } from '../lib/money'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MAX_PARCELAS = 12

/**
 * Os 24 meses a partir do CORRENTE. O mes corrente entra porque a compra pode ja
 * ter acontecido neste ciclo — e a fatura dela ainda nao chegou.
 */
function opcoesDeMes() {
  const base = todayISO().slice(0, 7)
  return Array.from({ length: 24 }, (_, i) => monthAdd(base, i))
}

/** "3 meses" / "1 mes" — usado na frase que explica por que o aporte < parcela. */
function labelMeses(de, ate) {
  const n = monthDiff(de, ate)
  return n === 1 ? '1 mês' : `${n} meses`
}

export default function PlanoPage() {
  const salvo = useDataset().data?.config?.plan ?? null
  const salvar = useSetPlan()

  const [label, setLabel] = useState('Viagem')
  const [valor, setValor] = useState('20.000,00')
  const [mesCompra, setMesCompra] = useState(monthAdd(todayISO().slice(0, 7), 4))
  const [parcelas, setParcelas] = useState(10)
  const [juros, setJuros] = useState('')
  const [guardado, setGuardado] = useState('')

  // o plano salvo manda enquanto o usuario nao mexe: sem isso o celular abre
  // sempre no exemplo, e o numero da tela nao e o plano que ele decidiu
  const [tocou, setTocou] = useState(false)
  useEffect(() => {
    if (!salvo || tocou) return
    setLabel(salvo.label ?? 'Viagem')
    setValor(brNum((salvo.valor_cents ?? 0) / 100, 2))
    if (salvo.mes_compra) setMesCompra(salvo.mes_compra)
    setParcelas(salvo.parcelas ?? 1)
    setJuros(salvo.juros_mes ? brNum(salvo.juros_mes * 100, 2) : '')
    setGuardado(salvo.guardado_cents ? brNum(salvo.guardado_cents / 100, 2) : '')
  }, [salvo]) // eslint-disable-line react-hooks/exhaustive-deps

  const valor_cents = parseMoney(valor) ?? 0
  const guardado_cents = parseMoney(guardado) ?? 0
  const juros_mes = (parseMoney(juros) ?? 0) / 10000 // "3,49" -> 0,0349

  /*
   * O horizonte tem que alcancar a ultima parcela da MAIOR alternativa, nao a
   * do parcelamento escolhido. Dimensionado pelo escolhido, escolher 1x cortava
   * a projecao em 7 meses e as linhas de 8x a 12x da tabela ficavam com parcela
   * fora do horizonte — aporte subestimado, e a coluna "cabe?" dizendo sim.
   */
  const proximo = monthAdd(todayISO().slice(0, 7), 1)
  const horizonte = Math.max(12, Math.min(48, monthDiff(proximo, mesCompra) + MAX_PARCELAS + 2))
  const { data: pts, isLoading, error } = useCashflow(horizonte, 0)

  const set = (fn) => (e) => { setTocou(true); fn(e.target.value) }

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

  const p = valor_cents
    ? goalPlan(pts, { valor_cents, mes_compra: mesCompra, parcelas, juros_mes, guardado_cents })
    : null

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Plano"
        subtitle="Um gasto grande lá na frente, contra a sobra que a projeção diz que você tem."
      />

      <div className="gap-card p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="gap-label">Objetivo</label>
            <input className="gap-input w-[150px] text-base md:text-sm" value={label} onChange={set(setLabel)} />
          </div>
          <div>
            <label className="gap-label">Valor</label>
            <input
              className="gap-input w-[130px] num text-base md:text-sm" inputMode="decimal"
              placeholder="0,00" value={valor} onChange={set(setValor)}
            />
          </div>
          <div>
            <label className="gap-label">Mês da compra</label>
            <select className="gap-input text-base md:text-sm" value={mesCompra} onChange={set(setMesCompra)}>
              {opcoesDeMes().map((m) => {
                const [y, mo] = m.split('-')
                return <option key={m} value={m}>{MESES[Number(mo) - 1]}/{y.slice(2)}</option>
              })}
            </select>
          </div>
          <div>
            <label className="gap-label">Parcelas</label>
            <select
              className="gap-input text-base md:text-sm" value={parcelas}
              onChange={(e) => { setTocou(true); setParcelas(Number(e.target.value)) }}
            >
              {Array.from({ length: MAX_PARCELAS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}x</option>
              ))}
            </select>
          </div>
          <div>
            <label className="gap-label">Juros % a.m.</label>
            <input
              className="gap-input w-[86px] num text-base md:text-sm" inputMode="decimal"
              placeholder="0" value={juros} onChange={set(setJuros)}
            />
          </div>
          <div>
            <label className="gap-label">Já guardado</label>
            <input
              className="gap-input w-[110px] num text-base md:text-sm" inputMode="decimal"
              placeholder="0,00" value={guardado} onChange={set(setGuardado)}
            />
          </div>
          <button
            className="gap-btn flex items-center gap-1.5"
            disabled={!valor_cents || salvar.isPending}
            onClick={() => salvar.mutate({
              label, valor_cents, mes_compra: mesCompra, parcelas, juros_mes, guardado_cents,
            })}
          >
            {salvar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Salvar
          </button>
        </div>
        <div className="text-[10.5px] text-gap-muted mt-2">
          Compra em <b>{monthLabel(mesCompra)}</b> cai na fatura de{' '}
          <b>{monthLabel(monthAdd(mesCompra, 1))}</b> — o ciclo do cartão joga o gasto do mês pra
          fatura seguinte. Deixe os juros em branco pro caso “{parcelas}x sem juros”.
        </div>
        {salvar.isError && (
          <div className="text-[11px] text-gap-red mt-1.5">
            não consegui salvar: {String(salvar.error?.message ?? salvar.error)}
          </div>
        )}
      </div>

      {!p
        ? <div className="gap-card p-4 mt-4 text-[12.5px] text-gap-muted">Informe o valor do objetivo.</div>
        : <Estudo p={p} pts={pts} label={label} />}
    </div>
  )
}

function Estudo({ p, pts, label }) {
  const ultimoIdx = pts.findIndex((x) => x.month === p.ultimo_mes)
  const nome = (label || 'o objetivo').toLowerCase()

  /*
   * Saldo ja com o objetivo dentro.
   *
   * O cashflow devolve o saldo SEM a viagem; aqui desconta-se a parcela
   * acumulada. E a unica leitura que responde a pergunta que importa, que nao e
   * "a parcela cabe no mes" e sim "o que sobra do ano depois disso".
   */
  let acc = 0
  const saldos = pts.map((row) => {
    acc += p.meses.find((m) => m.month === row.month)?.parcela_cents ?? 0
    return {
      month: row.month,
      p10: row.balance.p10 - acc,
      p50: row.balance.p50 - acc,
      p90: row.balance.p90 - acc,
    }
  })

  const apertaNoRuim = p.meses.find((m) => m.parcela_cents > 0 && m.apos_p10 < 0)

  return (
    <>
      <div className={clsx('gap-card p-3.5 mt-4 border-l-4', p.cabe ? 'border-l-gap-green' : 'border-l-gap-red')}>
        <div className="text-[13px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
          {p.cabe
            ? <Check size={15} className="text-gap-green shrink-0" />
            : <AlertTriangle size={15} className="text-gap-red shrink-0" />}
          {p.cabe
            ? <span>Guardando <b className="num">{money(p.aporte_cents)}</b> por mês, {nome} cabe.</span>
            : <span>Não cabe: exigiria <b className="num">{money(p.aporte_cents)}</b> por mês.</span>}
        </div>
        <div className="text-[11.5px] text-gap-muted">
          {p.parcelas}x de <b>{money(p.parcela_cents)}</b>, primeira na fatura de{' '}
          <b>{monthLabel(p.primeira_fatura)}</b> e última em <b>{monthLabel(p.ultimo_mes)}</b>.{' '}
          {p.parcelas > 1 && (
            <>O esforço mensal é <b>menor que a parcela</b> porque começa{' '}
              {labelMeses(pts[0].month, p.primeira_fatura)} antes dela: são{' '}
              <b>{p.aportes_n} meses</b> de disciplina, não {p.parcelas}.{' '}</>
          )}
          {p.cabe ? (
            <>Sobra projetada no período: <b>{money(p.sobra_media_cents)}</b>/mês — folga de{' '}
              <b className="text-gap-green">{money(p.folga_cents)}</b>.</>
          ) : (
            <>Sobra projetada no período: <b>{money(p.sobra_media_cents)}</b>/mês — faltam{' '}
              <b className="text-gap-red">{money(-p.folga_cents)}</b> por mês. Ou parcela em mais
              vezes, ou corta recorrente, ou adia.</>
          )}
        </div>
      </div>

      <div className="mt-4">
        <KpiGrid
          items={[
            { label: 'Guardar por mês', value: money(p.aporte_cents), tone: p.cabe ? 'neg' : 'pos', sub: `${p.aportes_n} meses` },
            { label: 'Parcela', value: money(p.parcela_cents), sub: `${p.parcelas}x` },
            { label: 'Sobra projetada', value: money(p.sobra_media_cents), sub: 'média p50 do período' },
            { label: 'Folga', value: moneySigned(p.folga_cents), tone: p.folga_cents >= 0 ? 'neg' : 'pos' },
            ...(p.juros_cents ? [{ label: 'Juros', value: money(p.juros_cents), tone: 'pos', sub: `total ${moneyShort(p.total_cents)}` }] : []),
          ]}
        />
      </div>

      {apertaNoRuim && (
        <div className="gap-card p-3.5 mt-4 border-l-4 border-l-[#f59e0b]">
          <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-[#f59e0b] shrink-0" />
            No cenário ruim, {monthLabel(apertaNoRuim.month)} não fecha sozinho
          </div>
          <div className="text-[11.5px] text-gap-muted">
            Com a parcela de {money(apertaNoRuim.parcela_cents)} e o gasto variável no p10,
            faltariam <b>{money(-apertaNoRuim.apos_p10)}</b> naquele mês. É pra isso que serve
            juntar antes: o aporte de {money(p.aporte_cents)} constrói a reserva que cobre o mês
            ruim sem recorrer ao limite do cartão.
          </div>
        </div>
      )}

      <div className="gap-card p-3.5 mt-4">
        <div className="text-[12px] font-semibold text-gap-navy mb-1">Quantas vezes parcelar</div>
        <div className="text-[11px] text-gap-muted mb-2">
          Sem juros, parcelar não muda o preço — muda <b>quanto você precisa guardar por mês</b> e
          por quanto tempo. A linha destacada é a escolhida.
        </div>
        <GapTable
          wrap maxHeight={380}
          columns={[
            { key: 'parcelas', label: 'Vezes', align: 'left', fmt: (n) => `${n}x` },
            { key: 'parcela_cents', label: 'Parcela', align: 'right', fmt: (c) => money(c) },
            { key: 'aporte_cents', label: 'Guardar/mês', align: 'right', fmt: (c, r) => (r.truncado ? '—' : <b>{money(c)}</b>) },
            { key: 'meses_de_plano', label: 'Meses', align: 'right', fmt: (n) => `${n}` },
            { key: 'sobra_media_cents', label: 'Sobra (p50)', align: 'right', fmt: (c) => money(c) },
            { key: 'folga_cents', label: 'Folga', align: 'right', colorSign: true, fmt: (c) => moneySigned(c) },
            {
              key: 'cabe', label: 'Cabe?', align: 'right',
              fmt: (v, r) => r.truncado
                ? <span className="text-gap-muted" title="última parcela além do horizonte projetado">—</span>
                : v
                  ? <span className="text-gap-green font-semibold">sim</span>
                  : <span className="text-gap-red font-semibold">não</span>,
            },
          ]}
          rows={p.alternativas.map((a) => ({ ...a, id: a.parcelas }))}
          rowClass={(r) => (r.parcelas === p.parcelas ? '[&>td]:!bg-[#eef6fd]' : undefined)}
        />
      </div>

      <div className="gap-card p-3.5 mt-4">
        <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-gap-muted" />
          Caixa acumulado já com {nome} dentro
        </div>
        <div className="text-[11px] text-gap-muted mb-2">
          Variação acumulada partindo de zero hoje, com as parcelas descontadas. O que importa é a
          inclinação e o ponto mais baixo, não o nível.
        </div>
        <FanChart pontos={saldos} height={230} />
      </div>

      <div className="gap-card p-3.5 mt-4">
        <div className="text-[12px] font-semibold text-gap-navy mb-2">Mês a mês</div>
        <GapTable
          wrap maxHeight={420}
          columns={[
            { key: 'month', label: 'Mês', align: 'left', fmt: (m) => <span className="whitespace-nowrap">{monthLabel(m)}</span> },
            { key: 'aporte_cents', label: 'Guardar', align: 'right', fmt: (c) => (c ? money(c) : '—') },
            { key: 'parcela_cents', label: 'Parcela', align: 'right', fmt: (c) => (c ? money(c) : '—') },
            ...(p.meses.some((m) => m.oneoff_in_cents || m.oneoff_out_cents) ? [{
              key: 'po', label: 'Pontual', align: 'right', colorSign: true,
              fmt: (_, r) => {
                const v = (r.oneoff_in_cents ?? 0) - (r.oneoff_out_cents ?? 0)
                return v ? moneySigned(v) : '—'
              },
            }] : []),
            { key: 'net_p50', label: 'Sobra (p50)', align: 'right', colorSign: true, fmt: (c) => moneySigned(c) },
            { key: 'apos_p50', label: 'Sobra após', align: 'right', colorSign: true, fmt: (c) => moneySigned(c) },
            { key: 'apos_p10', label: 'Cenário ruim', align: 'right', colorSign: true, fmt: (c) => moneySigned(c) },
          ]}
          rows={p.meses.slice(0, ultimoIdx + 2).map((m) => ({ ...m, id: m.month }))}
        />
      </div>

      <div className="text-[10.5px] text-gap-muted mt-3">
        <b>Guardar</b> é o menor aporte constante que mantém o plano no azul em <i>todo</i> mês de
        parcela — sai do mês que aperta mais, não da média, porque um plano que fecha no fim e fura
        no meio não fecha. <b>Sobra</b> vem do fluxo de caixa (renda − parcelas já contratadas −
        recorrentes − variável projetado), então <b>já embute o que você costuma gastar</b>: guardar
        esse valor não exige cortar nada além do que a projeção já supõe — e ela é a sobra
        <b> recorrente</b>: entradas pontuais ficam de fora dela e entram como caixa no mês em que
        chegam, abatendo o aporte em vez de virarem renda mensal. O cenário ruim é o p10 do
        variável, e o aporte já conta com o rendimento do caixa no CDB.{' '}
        {p.guardado_cents > 0 && <>Os {money(p.guardado_cents)} já guardados estão descontados.{' '}</>}
        A projeção já carrega uma provisão mensal de eventos vinda do seu histórico — este objetivo
        entra <b>por cima</b> dela, não no lugar dela.
      </div>
    </>
  )
}
