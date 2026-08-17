import { useState } from 'react'
import clsx from 'clsx'
import { Target, Loader2, Pencil, TrendingUp, TrendingDown } from 'lucide-react'
import { useSetBudget } from '../lib/api'
import { GAP, money, moneyShort, moneySigned, brNum } from '../theme/gap'

/**
 * Meta do mes na aba intra-mes.
 *
 * A capa e R$/dia e nao "% da meta consumida" de proposito: percentual descreve
 * o passado, o diario diz o que fazer hoje. O resto do card existe pra tornar
 * esse numero conferivel — de onde ele saiu e o que acontece se voce ignorar.
 */

/** Linha de uma categoria: consumido contra meta, com a marca do calendario. */
function LinhaCategoria({ c, elapsed }) {
  const semMeta = c.meta_cents == null
  const share = semMeta ? 0 : Math.max(0, c.share)
  const estourou = !semMeta && c.consumido_cents > c.meta_cents
  // adiantado = gastou proporcionalmente mais que o tempo decorrido
  const alerta = !semMeta && c.adiantado > 0.12
  const cor = estourou ? GAP.red : alerta ? '#f59e0b' : GAP.blue

  return (
    <div className="flex items-center gap-2.5 text-[12px] py-1">
      <span className="w-[104px] shrink-0 truncate" title={c.cat}>{c.cat}</span>

      <div className="flex-1 relative h-[18px] bg-gap-soft rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{ width: `${Math.min(100, share * 100)}%`, background: cor }}
        />
        {/* onde o gasto DEVERIA estar se fosse uniforme ao longo do ciclo */}
        {!semMeta && (
          <div
            className="absolute top-0 bottom-0 w-px bg-gap-navy/45"
            style={{ left: `${Math.min(100, elapsed * 100)}%` }}
            title={`${brNum(elapsed * 100, 0)}% do ciclo decorrido`}
          />
        )}
      </div>

      <span className="w-[86px] shrink-0 text-right num tabular-nums">
        {moneyShort(c.consumido_cents)}
        {!semMeta && <span className="text-gap-muted"> / {moneyShort(c.meta_cents)}</span>}
      </span>

      {/*
        Distancia da categoria = projetado (consumido / fracao decorrida) menos
        a meta. Vem com "~" quando a categoria tem menos de 8 lancamentos: com
        poucos pontos numa quinzena a anualizacao e indicacao, nao previsao.
      */}
      <span
        className={clsx(
          'w-[86px] shrink-0 text-right num text-[11.5px]',
          semMeta ? 'text-gap-muted'
            : c.distancia_cents > 0 ? 'text-gap-red font-semibold' : 'text-gap-green'
        )}
        title={semMeta ? '' : `no ritmo, fecha em ${money(c.projetado_cents)} · ${c.n} lançamentos`}
      >
        {semMeta ? 'sem meta'
          : `${c.confiavel ? '' : '~'}${moneySigned(-c.distancia_cents, 0)}`}
      </span>
    </div>
  )
}

function Editor({ goal, onClose }) {
  const set = useSetBudget()
  const [total, setTotal] = useState(String(goal.meta_total_cents / 100))
  const [cats, setCats] = useState(() =>
    Object.fromEntries(goal.categorias.map((c) => [c.cat, c.meta_cents == null ? '' : String(c.meta_cents / 100)]))
  )

  const salvar = async () => {
    const categories = {}
    for (const [k, v] of Object.entries(cats)) {
      const n = Number(String(v).replace(',', '.'))
      if (Number.isFinite(n) && n > 0) categories[k] = Math.round(n * 100)
    }
    await set.mutateAsync({
      total_cents: Math.round(Number(String(total).replace(',', '.')) * 100),
      categories,
    })
    onClose()
  }

  return (
    <div className="mt-3 pt-3 border-t border-gap-border">
      <label className="flex items-center gap-2 text-[12px] mb-2.5">
        <span className="w-[104px] shrink-0 font-semibold text-gap-navy">Meta do mês</span>
        <input
          className="gap-input num w-[120px]" inputMode="decimal"
          value={total} onChange={(e) => setTotal(e.target.value)}
        />
        <span className="text-gap-muted text-[11px]">total, incluindo os fixos fora do cartão</span>
      </label>

      <div className="flex flex-col gap-1">
        {goal.categorias.map((c) => (
          <label key={c.cat} className="flex items-center gap-2 text-[12px]">
            <span className="w-[104px] shrink-0 truncate text-gap-muted">{c.cat}</span>
            <input
              className="gap-input num w-[120px]" inputMode="decimal" placeholder="sem meta"
              value={cats[c.cat] ?? ''}
              onChange={(e) => setCats({ ...cats, [c.cat]: e.target.value })}
            />
          </label>
        ))}
      </div>

      {set.error && (
        <div className="mt-2 text-[12px] text-gap-red whitespace-pre-line">
          {String(set.error.message ?? set.error)}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button className="gap-btn" onClick={salvar} disabled={set.isPending}>
          {set.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Salvar'}
        </button>
        <button className="gap-btn !bg-gap-muted" onClick={onClose} disabled={set.isPending}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

export default function MetaCard({ v }) {
  const [editando, setEditando] = useState(false)
  const g = v.goal

  if (!g) {
    return (
      <div className="gap-card p-3.5 border-l-4 border-l-gap-blue">
        <div className="text-[12px] font-semibold text-gap-navy flex items-center gap-1.5">
          <Target size={13} className="text-gap-blue" />
          Sem meta definida
        </div>
        <div className="text-[11.5px] text-gap-muted mt-1 mb-2.5">
          Com uma meta mensal eu mostro quanto sobra por dia até o fim do ciclo e
          quanto de cada categoria já foi consumido.
        </div>
        <button className="gap-btn" onClick={() => setEditando(true)}>Definir meta</button>
        {editando && (
          <Editor
            goal={{ meta_total_cents: 800000, categorias: [] }}
            onClose={() => setEditando(false)}
          />
        )}
      </div>
    )
  }

  const estourou = g.disponivel_cents < 0
  const acimaDoRitmo = g.ritmo_cents > g.por_dia_cents
  const corte = g.ritmo_cents > 0 ? 1 - g.por_dia_cents / g.ritmo_cents : 0

  return (
    <div
      className={clsx('gap-card p-3.5 border-l-4', estourou ? 'border-l-gap-red' : 'border-l-gap-green')}
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Target size={13} className={estourou ? 'text-gap-red' : 'text-gap-green'} />
        <span className="text-[12px] font-semibold text-gap-navy">
          Meta de {money(g.meta_total_cents, 0)}
        </span>
        <span className="text-[11px] text-gap-muted">
          · teto de fatura {moneyShort(g.teto_fatura_cents)}
        </span>
        <button
          className="ml-auto text-gap-muted hover:text-gap-blue transition-colors p-1 -m-1"
          onClick={() => setEditando((x) => !x)} aria-label="editar meta"
        ><Pencil size={13} /></button>
      </div>

      <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
        {/* a capa */}
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-gap-muted">
            Posso gastar por dia
          </div>
          <div
            className={clsx('num font-bold leading-none mt-1',
              estourou ? 'text-gap-red text-[28px]' : 'text-gap-navy text-[32px]')}
          >
            {estourou ? money(0, 0) : money(g.por_dia_cents, 0)}
          </div>
          <div className="text-[11px] text-gap-muted mt-1">
            {estourou
              ? `já passou ${moneyShort(-g.disponivel_cents)} do teto`
              : `${moneyShort(g.disponivel_cents)} em ${g.dias_restantes} dia${g.dias_restantes === 1 ? '' : 's'}`}
          </div>
          {g.dias_sem_dado > 0 && (
            <div className="text-[10.5px] text-gap-muted mt-0.5">
              já descontados ~{moneyShort(g.nao_postado_cents)} de {g.dias_sem_dado} dia
              {g.dias_sem_dado === 1 ? '' : 's'} que o extrato ainda não mostra
            </div>
          )}
        </div>

        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-gap-muted">Ritmo atual</div>
          <div className={clsx('num font-bold text-[22px] leading-none mt-1.5',
            acimaDoRitmo ? 'text-gap-red' : 'text-gap-green')}>
            {money(g.ritmo_cents, 0)}
            <span className="text-[12px] font-normal text-gap-muted">/dia</span>
          </div>
          <div className="text-[11px] text-gap-muted mt-1 flex items-center gap-1">
            {acimaDoRitmo ? <TrendingUp size={11} className="text-gap-red" />
              : <TrendingDown size={11} className="text-gap-green" />}
            {acimaDoRitmo
              ? `precisa cortar ${brNum(corte * 100, 0)}%`
              : 'dentro do orçamento'}
          </div>
          <div className="text-[10.5px] text-gap-muted mt-0.5">
            {moneyShort(g.variavel_cents)} em {g.dias_com_dado} dias
          </div>
        </div>

        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-gap-muted">
            Neste ritmo, fecha em
          </div>
          <div className="num font-bold text-[22px] leading-none mt-1.5 text-gap-navy">
            {money(g.no_ritmo_cents, 0)}
          </div>
          <div className={clsx('text-[11px] mt-1 font-semibold',
            g.distancia_cents > 0 ? 'text-gap-red' : 'text-gap-green')}>
            {g.distancia_cents > 0
              ? `${moneyShort(g.distancia_cents)} acima da meta`
              : `${moneyShort(-g.distancia_cents)} de folga`}
          </div>
        </div>
      </div>

      {/*
        Por que nao ha projecao por categoria: com poucos lancamentos por
        categoria numa janela de 2 semanas, extrapolar multiplica ruido. A regua
        aqui e consumo contra meta, com a marca do calendario pra comparacao.
      */}
      {g.categorias.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-gap-border">
          {/*
            O teto do variavel, nao a meta cheia, e contra o que as categorias
            competem: parcela e recorrente consomem a meta antes de qualquer
            decisao sua. Sem esta linha, as metas por categoria pareciam soltas.
          */}
          {g.decomposicao && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] mb-2 pb-2 border-b border-gap-border">
              <span className="text-gap-muted">Meta {moneyShort(g.meta_total_cents)}</span>
              <span className="text-gap-muted">−</span>
              <span>travado <b>{moneyShort(g.decomposicao.travado_cents)}</b></span>
              <span className="text-gap-muted">=</span>
              <span className="text-gap-navy font-semibold">
                {moneyShort(g.decomposicao.teto_variavel_cents)} pro dia a dia
              </span>
              <span className="text-gap-muted">·</span>
              <span className={clsx(
                g.decomposicao.variavel_projetado_cents > g.decomposicao.teto_variavel_cents
                  ? 'text-gap-red font-semibold' : 'text-gap-green'
              )}>
                no ritmo fecha em {moneyShort(g.decomposicao.variavel_projetado_cents)}
              </span>
            </div>
          )}
          <div className="flex items-center text-[10.5px] text-gap-muted mb-1.5">
            <span className="flex-1">
              O traço marca os <b className="text-gap-navy">{brNum(v.elapsed_share * 100, 0)}%</b> do ciclo decorrido
            </span>
            <span className="w-[86px] text-right">sobra/estouro</span>
          </div>
          {g.categorias.map((c) => (
            <LinhaCategoria key={c.cat} c={c} elapsed={v.elapsed_share} />
          ))}
          {g.sem_meta_cents > 0 && (
            <div className="text-[10.5px] text-gap-muted mt-1.5">
              {moneyShort(g.sem_meta_cents)} em categorias sem meta definida — não entram na régua por categoria,
              mas contam no total.
            </div>
          )}
        </div>
      )}

      {/*
        Assinatura nao confirmada e cobrada uma vez no mes, mas como ela cai no
        variavel o ritmo a trata como gasto de todo dia — e projeta 30x um
        lancamento que ocorre 1x. Medycorp (R$ 488, cv 0,00) sozinho inflava o
        ritmo em ~R$ 35/dia. Por isso o aviso mora aqui e nao so no card abaixo.
      */}
      {v.candidates?.length > 0 && (
        <div className="mt-2.5 text-[10.5px] text-[#b45309]">
          {v.candidates.length} possível{v.candidates.length === 1 ? '' : 'eis'} recorrente
          {v.candidates.length === 1 ? '' : 's'} ainda não confirmado
          {v.candidates.length === 1 ? '' : 's'} ({moneyShort(v.candidates.reduce((a, c) => a + c.cents, 0))})
          — enquanto não confirmar, entram no ritmo diário como se fossem gasto de todo dia.
        </div>
      )}

      {editando && <Editor goal={g} onClose={() => setEditando(false)} />}
    </div>
  )
}
