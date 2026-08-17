import { useState } from 'react'
import clsx from 'clsx'
import { Trash2, Lock, Repeat, PencilLine, TrendingUp, Check, X, HelpCircle, Loader2, AlertTriangle, PartyPopper, ChevronDown, ChevronUp } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import QuickEntry from '../components/QuickEntry'
import MetaCard from '../components/MetaCard'

import { useMonthView, useDeleteTxn, useConfirmRecurring, useDismissRecurring, useRemoveRecurring, useMarkEvent } from '../lib/api'
import { clearAuth } from '../lib/github'
import { GAP, money, moneyShort, moneySigned, monthLabel, brNum } from '../theme/gap'

/** Barra de composicao do mes: travado -> lancado -> projetado. */
function Composicao({ v }) {
  const partes = [
    { label: 'Parcelas', cents: v.installments_cents, cor: GAP.navy, icon: Lock },
    { label: 'Assinaturas', cents: v.subscriptions_cents + v.fixed_card_cents, cor: GAP.blue, icon: Repeat },
    { label: 'Lançado', cents: v.logged_cents, cor: '#8b5cf6', icon: PencilLine },
    { label: 'Projetado', cents: v.remaining.p50, cor: '#cbd5e1', icon: TrendingUp },
    // fora do cartao: nao entra na fatura, mas sai do mesmo bolso
    { label: 'Fixos (fora)', cents: v.fixed_outflow_cents, cor: '#94a3b8', icon: Repeat },
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
  const base = v.baseline_cents + v.installments_cents + v.subscriptions_cents + v.fixed_card_cents
  const pts = [
    { l: 'Otimista', tag: 'p10', c: v.fatura.p10, cor: GAP.green },
    { l: 'Central', tag: 'p50', c: v.fatura.p50, cor: GAP.blue },
    { l: 'Pessimista', tag: 'p90', c: v.fatura.p90, cor: GAP.red },
  ]
  const max = Math.max(...pts.map((p) => p.c), base) * 1.08 || 1
  return (
    <div className="gap-card p-3.5">
      <div className="text-[12px] font-semibold text-gap-navy mb-3">Fatura estimada</div>
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
        <b>{moneyShort(v.fatura.p10)}</b> e <b>{moneyShort(v.fatura.p90)}</b>. Fora do cartão, mais {money(v.fixed_outflow_cents)} de fixos.
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
  // qual linha esta gravando — cada clique vira um commit no GitHub, que leva
  // ~1s. Sem estado visivel, o toque parece nao ter funcionado.
  const [busy, setBusy] = useState(null)
  const erro = ok.error ?? no.error

  if (!itens?.length) return null

  const agir = async (mut, arg, key) => {
    setBusy(key)
    try { await mut.mutateAsync(arg) } catch { /* mostrado no bloco de erro */ }
    finally { setBusy(null) }
  }

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

      {erro && (
        <div className="mb-2.5 text-[12px] text-gap-red border border-gap-red/30 bg-gap-red/5 rounded-md px-2.5 py-2 whitespace-pre-line leading-relaxed">
          {String(erro.message ?? erro)}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {itens.map((c) => {
          const gravando = busy === c.key
          return (
            <div
              key={c.key}
              className={clsx(
                'flex items-center gap-2 text-[12.5px] border border-gap-border rounded-md px-2.5 py-1.5 transition-opacity',
                gravando && 'opacity-50'
              )}
            >
              <span className="truncate flex-1" title={c.label}>{c.label}</span>
              <span className="hidden sm:inline text-gap-muted text-[11px] whitespace-nowrap">
                {c.months_seen}/6 meses · cv {brNum(c.cv, 2)}
              </span>
              <span className="num font-semibold whitespace-nowrap">{money(c.cents)}</span>
              {gravando ? (
                <Loader2 size={15} className="animate-spin text-gap-blue shrink-0" />
              ) : (
                <>
                  {/* p-2 e nao p-1: alvo de toque de ~32px, dedo nao acerta 20px */}
                  <button
                    className="text-gap-green hover:bg-gap-green/10 active:bg-gap-green/20 rounded p-2 -m-0.5 transition-colors disabled:opacity-40"
                    title="é recorrente" aria-label={`confirmar ${c.label}`}
                    disabled={!!busy}
                    onClick={() => agir(ok, { label: c.label, key: c.key, cents: c.cents, category: c.category ?? null }, c.key)}
                  ><Check size={15} /></button>
                  <button
                    className="text-gap-muted hover:text-gap-red hover:bg-gap-red/10 active:bg-gap-red/20 rounded p-2 -m-0.5 transition-colors disabled:opacity-40"
                    title="não é — parar de sugerir" aria-label={`dispensar ${c.label}`}
                    disabled={!!busy}
                    onClick={() => agir(no, c.key, c.key)}
                  ><X size={15} /></button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Recorrente confirmado que sumiu do extrato.
 *
 * Quase sempre o lojista mudou de nome ("CLAUDE.AI SUBSCRIPTION" ->
 * "Anthropic* Claude Sub"): o antigo vira custo fantasma travado e o novo
 * aparece como candidato. O mesmo gasto contado duas vezes.
 */
function Sumidos({ itens }) {
  const rm = useRemoveRecurring()
  const ok = useConfirmRecurring()
  const [busy, setBusy] = useState(null)
  if (!itens?.length) return null
  const total = itens.reduce((a, s) => a + s.cents, 0)

  /*
   * Migrar = remover o nome velho E confirmar o novo, nos dois passos.
   *
   * Antes eram duas acoes em dois cards diferentes, e parar no primeiro passo
   * APAGA uma despesa que continua sendo cobrada — o erro oposto, e pior,
   * porque o mes passa a parecer mais barato do que e.
   */
  const migrar = async (s) => {
    setBusy(s.key)
    try {
      await ok.mutateAsync({
        label: s.sucessor.label, key: s.sucessor.key,
        cents: s.sucessor.cents, category: s.category ?? null,
      })
      await rm.mutateAsync(s.key)
    } catch { /* mostrado abaixo */ } finally { setBusy(null) }
  }

  return (
    <div className="gap-card p-3.5 border-l-4 border-l-gap-red">
      <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
        <AlertTriangle size={13} className="text-gap-red" />
        {money(total)} contado duas vezes — o lojista mudou de nome
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        A despesa continua existindo; o que mudou foi o nome no extrato. Enquanto
        as duas versões coexistirem, ela conta em dobro — fantasma no travado e
        real no variável. <b>Migrar</b> troca o nome sem apagar a despesa.
      </div>
      <div className="flex flex-col gap-1.5">
        {itens.map((s) => (
          <div key={s.key} className="flex flex-col gap-1 text-[12.5px] border border-gap-border rounded-md px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="truncate flex-1" title={s.label}>{s.label}</span>
              <span className="num font-semibold whitespace-nowrap">{money(s.cents)}</span>
              {busy === s.key ? (
                <Loader2 size={15} className="animate-spin text-gap-blue shrink-0" />
              ) : (
                <>
                  {/* migrar so faz sentido se o nome novo AINDA nao estiver
                      cadastrado; se ja estiver, os dois estao ativos e o que
                      resta e apagar este */}
                  {s.sucessor && !s.sucessor.ja_declarado && (
                    <button
                      className="gap-btn !py-1 !px-2 !text-[11px] shrink-0"
                      onClick={() => migrar(s)} disabled={!!busy}
                    >Migrar</button>
                  )}
                  <button
                    className={clsx('rounded p-2 -m-0.5 disabled:opacity-40',
                      s.sucessor?.ja_declarado
                        ? 'gap-btn !py-1 !px-2 !text-[11px] !bg-gap-red shrink-0'
                        : 'text-gap-muted hover:text-gap-red hover:bg-gap-red/10')}
                    disabled={!!busy} aria-label={`remover ${s.label}`}
                    title={s.sucessor?.ja_declarado ? 'apagar o duplicado' : 'acabou de vez — remover'}
                    onClick={async () => { setBusy(s.key); try { await rm.mutateAsync(s.key) } catch {} finally { setBusy(null) } }}
                  >{s.sucessor?.ja_declarado ? 'Apagar este' : <Trash2 size={15} />}</button>
                </>
              )}
            </div>
            {s.sucessor?.ja_declarado ? (
              <div className="text-[10.5px] text-gap-red">
                <b>{s.sucessor.label}</b> ({money(s.sucessor.cents)}) já está cadastrado — os dois
                estão ativos e a despesa conta em dobro. Apague este.
              </div>
            ) : s.sucessor ? (
              <div className="text-[10.5px] text-gap-muted">
                virou <b className="text-gap-navy">{s.sucessor.label}</b> ({money(s.sucessor.cents)},
                em {s.sucessor.meses} das últimas 3 faturas)
              </div>
            ) : (
              <div className="text-[10.5px] text-gap-muted">
                não achei substituto com valor parecido — se a despesa acabou mesmo, remova
              </div>
            )}
          </div>
        ))}
      </div>
      {(rm.error || ok.error) && (
        <div className="mt-2 text-[12px] text-gap-red whitespace-pre-line">
          {String((rm.error ?? ok.error).message ?? (rm.error ?? ok.error))}
        </div>
      )}
    </div>
  )
}

/**
 * Gasto que parece evento, nao rotina.
 *
 * Sem essa marca, uma festa entra na base e vira previsao de festa TODO mes —
 * chegou a esconder, por coincidencia, um corte grande feito em outra linha. Confirmado, o gasto continua contando no saldo e na fatura (o
 * dinheiro saiu), mas sai do nivel que projeta os meses a frente.
 */
function Eventos({ itens }) {
  const mark = useMarkEvent()
  const [busy, setBusy] = useState(null)
  if (!itens?.length) return null

  const agir = async (it, isEvent) => {
    setBusy(it.key)
    try { await mark.mutateAsync({ key: it.key, isEvent, label: it.desc }) } catch {}
    finally { setBusy(null) }
  }

  return (
    <div className="gap-card p-3.5 border-l-4 border-l-[#8b5cf6]">
      <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
        <PartyPopper size={13} className="text-[#8b5cf6]" />
        Isso foi evento?
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        Gasto fora de escala pro padrão do lojista. Marcando como evento, ele continua
        no saldo e na fatura — mas para de virar previsão mensal.
      </div>
      <div className="flex flex-col gap-1.5">
        {itens.map((c) => {
          const gravando = busy === c.key
          return (
            <div
              key={c.key}
              className={clsx(
                'flex items-center gap-2 text-[12.5px] border border-gap-border rounded-md px-2.5 py-1.5',
                gravando && 'opacity-50'
              )}
            >
              <span className="text-gap-muted text-[11px] w-[38px] shrink-0 num">
                {c.date.slice(8, 10)}/{c.date.slice(5, 7)}
              </span>
              <span className="truncate flex-1" title={c.desc}>{c.desc}</span>
              <span className="hidden sm:inline text-gap-muted text-[10.5px] whitespace-nowrap">
                {c.motivo}
              </span>
              <span className="num font-semibold whitespace-nowrap">{money(c.cents)}</span>
              {gravando ? (
                <Loader2 size={15} className="animate-spin text-gap-blue shrink-0" />
              ) : (
                <>
                  <button
                    className="text-[#8b5cf6] hover:bg-[#8b5cf6]/10 rounded p-2 -m-0.5 disabled:opacity-40"
                    title="foi evento" aria-label={`marcar ${c.desc} como evento`}
                    disabled={!!busy} onClick={() => agir(c, true)}
                  ><Check size={15} /></button>
                  <button
                    className="text-gap-muted hover:text-gap-red hover:bg-gap-red/10 rounded p-2 -m-0.5 disabled:opacity-40"
                    title="é rotina — parar de sugerir" aria-label={`dispensar ${c.desc}`}
                    disabled={!!busy} onClick={() => agir(c, false)}
                  ><X size={15} /></button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {mark.error && (
        <div className="mt-2 text-[12px] text-gap-red whitespace-pre-line">
          {String(mark.error.message ?? mark.error)}
        </div>
      )}
    </div>
  )
}

/**
 * O que ainda vai entrar na fatura, aberto.
 *
 * Duas naturezas, separadas de proposito: o fixo e nomeavel item a item (uma
 * assinatura que cai no dia 26 nao tem o que decidir) e o variavel e o unico
 * pedaco que responde ao que voce fizer amanha. Somados num numero so, o KPI
 * escondia qual metade da pra agir.
 */
function AindaEntra({ v }) {
  // aberto por padrao: a tabela E o conteudo do card. Recolhido, o card virava
  // mais um numero agregado — exatamente o que ele existe pra abrir.
  const [aberto, setAberto] = useState(true)
  const linhas = v.falta_por_categoria ?? []
  if (!linhas.length) return null
  const fixo = linhas.reduce((a, l) => a + l.fixo_cents, 0)
  const varia = linhas.reduce((a, l) => a + l.variavel_cents, 0)
  const max = Math.max(...linhas.map((l) => l.total_cents), 1)

  return (
    <div className="gap-card p-3.5">
      <button
        className="w-full flex items-center gap-1.5 text-left"
        onClick={() => setAberto((x) => !x)}
      >
        <TrendingUp size={13} className="text-gap-muted" />
        <span className="text-[12px] font-semibold text-gap-navy">
          Ainda deve entrar · {money(fixo + varia)}
        </span>
        <span className="text-[11px] text-gap-muted">
          {moneyShort(fixo)} já contratado + {moneyShort(varia)} de gasto do dia a dia
        </span>
        {aberto ? <ChevronUp size={14} className="ml-auto text-gap-muted" />
          : <ChevronDown size={14} className="ml-auto text-gap-muted" />}
      </button>

      {aberto && (
        <div className="mt-3">
          <div className="flex items-center text-[10.5px] text-gap-muted mb-1">
            <span className="w-[118px] shrink-0">categoria</span>
            <span className="flex-1" />
            <span className="w-[78px] text-right">já contratado</span>
            <span className="w-[78px] text-right">dia a dia</span>
            <span className="w-[76px] text-right">total</span>
          </div>
          {linhas.map((l) => (
            <div key={l.cat} className="flex items-center text-[12px] py-[3px]">
              <span className="w-[118px] shrink-0 truncate" title={l.cat}>{l.cat}</span>
              <span className="flex-1 px-2">
                <span className="flex h-[14px] rounded-sm overflow-hidden bg-gap-soft"
                  style={{ width: `${(l.total_cents / max) * 100}%` }}>
                  {/* navy = certo, cinza = estimado */}
                  <span style={{ flex: l.fixo_cents, background: GAP.navy }} />
                  <span style={{ flex: l.variavel_cents, background: '#cbd5e1' }} />
                </span>
              </span>
              <span className="w-[78px] text-right num tabular-nums">
                {l.fixo_cents ? money(l.fixo_cents, 0) : <span className="text-gap-muted">—</span>}
              </span>
              <span className="w-[78px] text-right num tabular-nums text-gap-muted">
                {l.variavel_cents ? money(l.variavel_cents, 0) : '—'}
              </span>
              <span className="w-[76px] text-right num tabular-nums font-semibold">
                {money(l.total_cents, 0)}
              </span>
            </div>
          ))}

          {v.a_entrar_itens?.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-gap-border">
              <div className="text-[10.5px] text-gap-muted mb-1">
                Os {v.a_entrar_itens.length} recorrentes que ainda não postaram neste ciclo:
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {[...v.a_entrar_itens].sort((a, b) => b.cents - a.cents).map((s) => (
                  <span key={s.key ?? s.label} className="text-[11px]">
                    <span className="text-gap-muted">{s.label.slice(0, 24)}</span>{' '}
                    <b className="num">{money(s.cents, 0)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="text-[10.5px] text-gap-muted mt-2">
            O dia a dia é rateado pela distribuição do que você já gastou neste ciclo —
            o total vem do agregado, que é o número confiável; a divisão entre categorias é indicativa.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Lancamento manual que a fatura ja trouxe.
 *
 * Casado por valor exato + ate 3 dias, SEM exigir lojista — no manual voce
 * digita o app de entrega e o extrato traz o restaurante. Exigir semelhanca de
 * nome, como faz o reconcile do import, deixava passar tudo.
 */
function Duplicados({ itens }) {
  const del = useDeleteTxn()
  const [busy, setBusy] = useState(null)
  if (!itens?.length) return null
  const total = itens.reduce((a, d) => a + d.manual.cents, 0)

  return (
    <div className="gap-card p-3.5 border-l-4 border-l-gap-red">
      <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
        <AlertTriangle size={13} className="text-gap-red" />
        {money(total)} contado duas vezes
      </div>
      <div className="text-[11px] text-gap-muted mb-2.5">
        Você lançou na mão e a fatura já trouxe o mesmo gasto. Apagando o lançamento
        manual, fica só o do banco — que é o valor real.
      </div>
      <div className="flex flex-col gap-1.5">
        {itens.map(({ manual: m, fatura: f }) => (
          <div key={m.id} className="flex items-center gap-2 text-[12px] border border-gap-border rounded-md px-2.5 py-1.5">
            <span className="text-gap-muted num text-[11px] w-[38px] shrink-0">
              {m.date.slice(8, 10)}/{m.date.slice(5, 7)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="truncate">{m.desc}</div>
              <div className="truncate text-[10.5px] text-gap-muted">
                na fatura: {f.desc} · {f.date.slice(8, 10)}/{f.date.slice(5, 7)}
              </div>
            </div>
            <span className="num font-semibold whitespace-nowrap">{money(m.cents)}</span>
            <button
              className="text-gap-red hover:bg-gap-red/10 rounded p-2 -m-0.5 disabled:opacity-40"
              disabled={busy === m.id} aria-label={`apagar ${m.desc}`}
              onClick={async () => {
                setBusy(m.id)
                try { await del.mutateAsync(m.id) } catch {} finally { setBusy(null) }
              }}
            >
              {busy === m.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MesCorrentePage() {
  const { data: v, isLoading, error } = useMonthView()
  const del = useDeleteTxn()

  // erro primeiro; depois QUALQUER ausencia de dado vira "carregando".
  // O `return null` que estava aqui era exatamente a tela branca: query
  // desabilitada nao e isLoading nem error, e a pagina renderizava nada.
  if (error) {
    return (
      <div className="p-5">
        <div className="gap-card p-4 max-w-[560px]">
          <div className="text-[14px] font-bold text-gap-red mb-1">Não consegui carregar</div>
          <div className="text-[12.5px] whitespace-pre-line leading-relaxed">
            {String(error.message ?? error)}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="gap-btn" onClick={() => location.reload()}>Tentar de novo</button>
            <button className="gap-btn !bg-gap-muted" onClick={() => { clearAuth(); location.reload() }}>
              Trocar token
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (!v) {
    return (
      <div className="p-6 text-gap-muted text-sm">
        {isLoading ? 'carregando do GitHub…' : 'preparando…'}
      </div>
    )
  }

  const manuais = v.logged
  const travado = v.installments_cents + v.subscriptions_cents + v.fixed_card_cents + v.fixed_outflow_cents

  return (
    <div className="p-5 max-w-[1180px] mx-auto">
      <PageHeader
        title={`Fatura de ${monthLabel(v.fatura_alvo)}${v.tem_fatura_aberta ? ' · em aberto' : ''}`}
        subtitle={
          v.tem_fatura_aberta
            ? `Vence dia 5. Fecha com o que você gastar até o fim de ${monthLabel(v.month)} — ` +
              `${brNum(v.elapsed_share * 100, 0)}% do ciclo já passou.`
            : `Fatura em formação com os gastos de ${monthLabel(v.month)}. ` +
              `Importe a fatura aberta para ver o valor real em vez de estimativa.`
        }
      />

      {/* antes dos KPIs: "quanto posso gastar hoje" e a unica pergunta que a
          tela responde de manha. O resto e o porque desse numero. */}
      <div className="mb-4"><MetaCard v={v} /></div>

      <KpiGrid
        items={[
          { label: 'Já travado', value: money(travado), sub: 'parcelas + recorrentes', tone: 'pos' },
          {
            label: v.tem_fatura_aberta ? 'Já na fatura' : 'Lançado por você',
            value: money(v.ja_na_fatura_cents),
            sub: v.tem_fatura_aberta
              ? (v.manual_cents ? `da fatura + ${money(v.manual_cents)} lançado` : 'já na fatura aberta')
              : `${v.logged_count} lançamento${v.logged_count === 1 ? '' : 's'}`,
          },
          { label: 'Ainda deve entrar', value: money(v.a_entrar_cents + v.remaining.p50), sub: `previsão · ${moneyShort(v.remaining.p10 + v.a_entrar_cents)} – ${moneyShort(v.remaining.p90 + v.a_entrar_cents)}` },
          { label: 'Fatura estimada', value: money(v.fatura.p50), sub: `faixa 80%: ${moneyShort(v.fatura.p10)} – ${moneyShort(v.fatura.p90)}`, tone: 'pos' },
          { label: 'Sobra estimada', value: moneySigned(v.net.p50), sub: `renda ${moneyShort(v.income_cents)} − fatura − ${moneyShort(v.fixed_outflow_cents)} fixos`, tone: v.net.p50 >= 0 ? 'neg' : 'pos' },
        ]}
      />

      <div className="mt-4"><AindaEntra v={v} /></div>
      <div className="mt-3"><QuickEntry /></div>
      <div className="mt-3"><Composicao v={v} /></div>
      {v.duplicados?.length > 0 && <div className="mt-3"><Duplicados itens={v.duplicados} /></div>}
      {v.sumidos?.length > 0 && <div className="mt-3"><Sumidos itens={v.sumidos} /></div>}
      {v.candidates?.length > 0 && <div className="mt-3"><Candidatos itens={v.candidates} /></div>}
      {v.eventCandidates?.length > 0 && <div className="mt-3"><Eventos itens={v.eventCandidates} /></div>}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div className="gap-card p-3.5">
          <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
            <Lock size={13} className="text-gap-muted" />
            Parcelas na fatura de {monthLabel(v.fatura_alvo)}
            <span className="ml-auto num text-gap-muted font-normal">{money(v.installments_cents)}</span>
          </div>
          <GapTable
            wrap maxHeight={300}
            empty="nenhuma parcela este mês"
            columns={[
              { key: 'label', label: 'Contrato', align: 'left', fmt: (x) => <span className="truncate block max-w-[230px]" title={x}>{x}</span> },
              { key: 'number', label: 'Parcela', fmt: (_, r) => `${r.number}/${r.total}` },
              { key: 'remaining', label: 'Restam', fmt: (x) => `${x}` },
              { key: 'cents', label: 'Valor', align: 'right', fmt: (c) => money(c) },
            ]}
            rows={v.installments}
          />
        </div>

        <div className="gap-card p-3.5">
          <div className="text-[12px] font-semibold text-gap-navy mb-2 flex items-center gap-1.5">
            <Repeat size={13} className="text-gap-muted" />
            Recorrentes
            <span className="ml-auto num text-gap-muted font-normal">
              {money(v.subscriptions_cents + v.fixed_card_cents + v.fixed_outflow_cents)}
            </span>
          </div>
          <GapTable
            wrap maxHeight={300}
            empty="nada recorrente detectado"
            columns={[
              { key: 'label', label: 'Item', align: 'left', fmt: (x) => <span className="truncate block max-w-[210px]" title={x}>{x}</span> },
              { key: 'declared', label: 'Origem', fmt: (d, r) => d ? 'cadastrado' : `${r.months_seen}/6 meses` },
              { key: 'cents', label: 'Valor', align: 'right', fmt: (c) => money(c) },
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
          {/* manual_cents, nao logged_cents: este ultimo soma o variavel da
              fatura importada, entao o cabecalho mostrava um total uma ordem de
              grandeza acima da soma das linhas da propria tabela */}
          <span className="ml-auto num text-gap-muted font-normal">{money(v.manual_cents)}</span>
        </div>
        <GapTable
          wrap maxHeight={360}
          empty="nada lançado ainda — use a linha acima"
          columns={[
            { key: 'date', label: 'Data', fmt: (x) => x?.slice(8, 10) + '/' + x?.slice(5, 7) },
            { key: 'desc', label: 'Onde', align: 'left' },
            { key: 'cat', label: 'Categoria', fmt: (x, r) => x ? `${x}${r.sub ? ` · ${r.sub}` : ''}` : '—' },
            { key: 'cents', label: 'Valor', align: 'right', fmt: (c) => money(c) },
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
