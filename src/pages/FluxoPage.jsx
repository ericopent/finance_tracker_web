import { useState } from 'react'
import { AlertTriangle, Wallet, Plus, Trash2, Loader2, PiggyBank } from 'lucide-react'
import clsx from 'clsx'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import FanChart from '../components/FanChart'
import { useCashflow, useDataset, useAddOneoff, useRemoveOneoff, useSetYield } from '../lib/api'
import { money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'
import { parseMoney, todayISO } from '../lib/money'
import { monthAdd, monthlyYield } from '../lib/engine'

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/**
 * Entradas e saidas que caem num mes so.
 *
 * O Pix de reembolso, o bonus, a matricula da escola. Cadastrar como recorrente
 * inflaria os 12 meses do horizonte; deixar de fora faz a projecao mentir pra
 * baixo justamente no mes em que o dinheiro entra ou sai.
 */
function Pontuais({ itens }) {
  const add = useAddOneoff()
  const rm = useRemoveOneoff()
  const [label, setLabel] = useState('')
  const [valor, setValor] = useState('')
  const [mes, setMes] = useState(monthAdd(todayISO().slice(0, 7), 1))
  const [dir, setDir] = useState('inflow')
  const [busy, setBusy] = useState(null)

  const cents = parseMoney(valor) ?? 0
  const meses = Array.from({ length: 24 }, (_, i) => monthAdd(todayISO().slice(0, 7), i))

  const gravar = async () => {
    if (!cents || !label.trim()) return
    setBusy('add')
    try {
      await add.mutateAsync({ label: label.trim(), cents, month: mes, direction: dir })
      setLabel(''); setValor('')
    } catch { /* mostrado abaixo */ } finally { setBusy(null) }
  }

  const apagar = async (id) => {
    setBusy(id)
    try { await rm.mutateAsync(id) } catch { /* abaixo */ } finally { setBusy(null) }
  }

  return (
    <div className="gap-card p-3.5 mt-4">
      <div className="text-[12px] font-semibold text-gap-navy mb-1">Entradas e saídas pontuais</div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        Dinheiro que entra ou sai <b>uma vez</b>, num mês específico. Entra no caixa daquele mês,
        mas fica fora da <b>sobra média</b> que o Plano usa como régua — média de evento único vira
        previsão de que ele se repete.
      </div>

      {itens.length > 0 && (
        <div className="flex flex-col gap-1 mb-2.5">
          {itens.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-[12.5px] border border-gap-border rounded-md px-2.5 py-1.5">
              <span className="text-gap-muted text-[11px] w-[52px] shrink-0">{monthLabel(o.month)}</span>
              <span className="truncate flex-1" title={o.label}>{o.label}</span>
              <span className={clsx('num font-semibold whitespace-nowrap',
                o.direction === 'outflow' ? 'text-gap-red' : 'text-gap-green')}>
                {o.direction === 'outflow' ? '−' : '+'}{money(o.cents)}
              </span>
              {busy === o.id
                ? <Loader2 size={14} className="animate-spin text-gap-blue shrink-0" />
                : (
                  <button
                    className="text-gap-muted hover:text-gap-red shrink-0" onClick={() => apagar(o.id)}
                    disabled={!!busy} aria-label={`remover ${o.label}`}
                  ><Trash2 size={14} /></button>
                )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="gap-label">Descrição</label>
          <input
            className="gap-input w-[170px] text-base md:text-sm" placeholder="Pix da passagem"
            value={label} onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="gap-label">Mês</label>
          <select className="gap-input text-base md:text-sm" value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((m) => {
              const [y, mo] = m.split('-')
              return <option key={m} value={m}>{MES_CURTO[Number(mo) - 1]}/{y.slice(2)}</option>
            })}
          </select>
        </div>
        <div>
          <label className="gap-label">Valor</label>
          <input
            className="gap-input w-[110px] num text-base md:text-sm" inputMode="decimal"
            placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)}
          />
        </div>
        <div>
          <label className="gap-label">Tipo</label>
          <select className="gap-input text-base md:text-sm" value={dir} onChange={(e) => setDir(e.target.value)}>
            <option value="inflow">entra</option>
            <option value="outflow">sai</option>
          </select>
        </div>
        <button className="gap-btn flex items-center gap-1.5" onClick={gravar} disabled={!cents || !label.trim() || !!busy}>
          {busy === 'add' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Incluir
        </button>
      </div>
      {(add.isError || rm.isError) && (
        <div className="text-[11px] text-gap-red mt-1.5">
          não consegui salvar: {String((add.error ?? rm.error)?.message ?? add.error ?? rm.error)}
        </div>
      )}
    </div>
  )
}

/**
 * Onde a sobra fica parada.
 *
 * Saldo na conta corrente rende zero; no CDB de 100% do CDI rende ~0,87% ao mes
 * liquido. Em 12 meses de plano isso e um mes inteiro de aporte que o juro paga
 * sozinho — grande demais pra projecao fingir que nao existe.
 */
function Rendimento({ cfg }) {
  const salvar = useSetYield()
  const y = cfg?.yield ?? { cdi_aa: 0.139, pct_cdi: 1, ir: 0.20 }
  const [cdi, setCdi] = useState(brNum(y.cdi_aa * 100, 2))
  const [pct, setPct] = useState(brNum((y.pct_cdi ?? 1) * 100, 0))
  const [ir, setIr] = useState(brNum((y.ir ?? 0.2) * 100, 1))

  const num = (v) => {
    const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  const proposto = { cdi_aa: num(cdi) / 100, pct_cdi: num(pct) / 100, ir: num(ir) / 100 }
  const mensal = monthlyYield({ yield: proposto })

  return (
    <div className="gap-card p-3.5 mt-4">
      <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
        <PiggyBank size={13} className="text-gap-muted" />
        Rendimento do caixa parado
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        O saldo projetado rende <b className="num">{brNum(mensal * 100, 3)}% ao mês</b> líquido —
        e o Plano usa isso pra baixar o quanto você precisa guardar. Zere o CDI pra voltar a
        projetar dinheiro parado na conta.
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="gap-label">CDI % a.a.</label>
          <input className="gap-input w-[86px] num text-base md:text-sm" inputMode="decimal"
                 value={cdi} onChange={(e) => setCdi(e.target.value)} />
        </div>
        <div>
          <label className="gap-label">% do CDI</label>
          <input className="gap-input w-[76px] num text-base md:text-sm" inputMode="decimal"
                 value={pct} onChange={(e) => setPct(e.target.value)} />
        </div>
        <div>
          <label className="gap-label">IR %</label>
          <input className="gap-input w-[70px] num text-base md:text-sm" inputMode="decimal"
                 value={ir} onChange={(e) => setIr(e.target.value)} />
        </div>
        <button className="gap-btn flex items-center gap-1.5" disabled={salvar.isPending}
                onClick={() => salvar.mutate(proposto)}>
          {salvar.isPending && <Loader2 size={13} className="animate-spin" />}
          Salvar
        </button>
      </div>
      <div className="text-[10.5px] text-gap-muted mt-2">
        O IR sai do juro <b>todo mês</b>, não só no resgate: é conservador de propósito, porque a
        tabela regressiva (22,5% até 180 dias, 20% até 360, 17,5% até 720) cobra menos quanto mais
        tempo o dinheiro fica. Errar pro lado de guardar demais falha melhor que o contrário.
      </div>
      {salvar.isError && (
        <div className="text-[11px] text-gap-red mt-1.5">
          não consegui salvar: {String(salvar.error?.message ?? salvar.error)}
        </div>
      )}
    </div>
  )
}

export default function FluxoPage() {
  // saldo de partida: sem ele o grafico so mostra a VARIACAO acumulada, que nao
  // responde "quando eu fico no vermelho"
  const [saldo, setSaldo] = useState('')
  const abertura = parseMoney(saldo) ?? 0
  const [horizonte, setHorizonte] = useState(12)

  const { data: pts, isLoading, error } = useCashflow(horizonte, abertura)
  // a meta vive no config (definida na aba Mês Corrente); aqui ela vira régua
  const cfg = useDataset().data?.config
  const meta = cfg?.budget?.total_cents || null
  const pontuais = cfg?.oneoffs ?? []

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
  // a pergunta que a meta cria: em que mes ela deixa de exigir esforco?
  const primeiroNaMeta = meta ? pts.find((p) => p.gasto.p50 <= meta) : null
  const regime = pts[0]?.regime ?? null

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

      {/*
        A projecao usa 12 meses. Se os ultimos 4 contam outra historia, o
        numero da tabela descreve um padrao que voce ja abandonou — e melhor
        dizer isso do que deixar decidir em cima de media velha.
      */}
      {regime && Math.abs(regime.divergencia) > 0.10 && (
        <div className="gap-card p-3.5 mt-4 border-l-4 border-l-[#f59e0b]">
          <div className="text-[12.5px] font-semibold text-gap-navy flex items-center gap-1.5 mb-1">
            <AlertTriangle size={14} className="text-[#f59e0b]" />
            Projeção ancorada nas {regime.meses_curto} últimas faturas, não na média longa
          </div>
          <div className="text-[11.5px] text-gap-muted">
            Últimas {regime.meses_curto}: <b>{money(regime.p50_curto)}</b>/mês de variável. Média dos
            12 meses: <b>{money(regime.p50_longo)}</b>/mês —{' '}
            <b className={regime.divergencia < 0 ? 'text-gap-green' : 'text-gap-red'}>
              {brNum(Math.abs(regime.divergencia) * 100, 0)}% {regime.divergencia < 0 ? 'acima' : 'abaixo'}
            </b>{' '}do que você roda agora. A tabela usa o número recente, então mudança de hábito
            aparece no mês seguinte. A faixa p10–p90 continua vindo dos 12 meses: 2 faturas dizem
            onde está o nível, não quanto ele costuma variar.
          </div>
        </div>
      )}

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

      <Pontuais itens={pontuais} />

      <Rendimento cfg={cfg} />

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
            {
              key: 'month', label: 'Mês', align: 'left',
              fmt: (m, r) => (
                <span className="whitespace-nowrap">
                  {monthLabel(m)}
                  {r.ancorado && (
                    <span className="ml-1 text-[9.5px] text-gap-blue" title="fatura em formação: valor conhecido, não projetado">
                      ●
                    </span>
                  )}
                </span>
              ),
            },
            { key: 'income_cents', label: 'Renda', align: 'right', fmt: (c) => money(c) },
            ...(pontuais.length ? [{
              key: 'po', label: 'Pontual', align: 'right', colorSign: true,
              fmt: (_, r) => {
                const v = (r.oneoff_in_cents ?? 0) - (r.oneoff_out_cents ?? 0)
                return v ? moneySigned(v) : '—'
              },
            }] : []),
            { key: 'installments_cents', label: 'Parcelas', align: 'right', fmt: (c) => money(c) },
            { key: 'recurring_cents', label: 'Recorrente', align: 'right', fmt: (c) => money(c) },
            { key: 'd', label: 'Variável (p50)', align: 'right', fmt: (_, r) => money(r.discretionary.p50) },
            ...(regime?.provisao_eventos ? [{
              key: 'ev', label: 'Eventos', align: 'right',
              // no mes ancorado o evento real ja esta dentro do variavel medido
              fmt: (_, r) => (r.ancorado ? '—' : money(regime.provisao_eventos)),
            }] : []),
            { key: 'g', label: 'Gasto (p50)', align: 'right', fmt: (_, r) => money(r.gasto.p50) },
            ...(meta ? [{
              key: 'vm', label: 'vs meta', align: 'right', colorSign: true,
              // sinal invertido: gastar ABAIXO da meta e o resultado bom
              fmt: (_, r) => moneySigned(meta - r.gasto.p50),
            }] : []),
            ...(pts.some((x) => x.juros_cents) ? [{
              key: 'ju', label: 'Juros CDB', align: 'right', colorSign: true,
              fmt: (_, r) => (r.juros_cents ? moneySigned(r.juros_cents) : '—'),
            }] : []),
            { key: 'n', label: 'Sobra (p50)', align: 'right', colorSign: true, fmt: (_, r) => moneySigned(r.net.p50) },
            { key: 'b', label: 'Saldo (p50)', align: 'right', colorSign: true, fmt: (_, r) => moneySigned(r.balance.p50) },
          ]}
          rows={pts.map((p) => ({ ...p, id: p.month }))}
        />
        <div className="text-[10.5px] text-gap-muted mt-2">
          Parcelas caem sozinhas conforme os contratos vencem — em {monthLabel(pts[0].month)} são{' '}
          <b>{money(pts[0].installments_cents)}</b>, e no fim do período{' '}
          <b>{money(fim.installments_cents)}</b>. Isso é dinheiro que volta pro seu bolso sem você fazer nada.
          {meta && primeiroNaMeta && (
            <> No cenário central, o primeiro mês que cabe na meta de {moneyShort(meta)} é{' '}
              <b>{monthLabel(primeiroNaMeta.month)}</b>.</>
          )}
          {meta && !primeiroNaMeta && (
            <> <b className="text-gap-red">Nenhum mês do período cabe na meta de {moneyShort(meta)}</b> —
              o gasto projetado nunca cai o suficiente sozinho.</>
          )}
        </div>
      </div>

      <div className="text-[10.5px] text-gap-muted mt-3">
        {pts[0].ancorado ? (
          <>
            <b className="text-gap-blue">●</b> {monthLabel(pts[0].month)} não é projeção: é a fatura em
            formação, com o que já foi lançado e as parcelas já conhecidas — o mesmo número da aba Mês
            Corrente. Dos meses seguintes em diante, o variável vem da mediana dos últimos 12 meses
            fechados ({money(pts[1]?.discretionary.p50 ?? 0)}/mês).
          </>
        ) : (
          <>
            O variável projetado vem da mediana dos seus últimos 12 meses fechados
            ({money(pts[0].discretionary.p50)}/mês).
          </>
        )}{' '}
        Se você mudar de hábito, a projeção só percebe depois que o histórico mudar — ela é âncora,
        não bola de cristal.{' '}
        {regime?.provisao_eventos ? (
          <>
            Gastos marcados como <b>evento</b> ({moneyShort(regime.total_eventos)} em{' '}
            {regime.meses_evento} dos últimos 12 meses) saem do nível e voltam diluídos como
            provisão de <b>{money(regime.provisao_eventos)}/mês</b> — contam no saldo, mas não
            viram previsão de que a festa se repete.
          </>
        ) : (
          <>Nenhum gasto marcado como evento ainda. Enquanto não marcar, uma viagem ou uma festa
            entra no nível como se fosse mensalidade e infla todos os meses à frente.</>
        )}
      </div>
    </div>
  )
}
