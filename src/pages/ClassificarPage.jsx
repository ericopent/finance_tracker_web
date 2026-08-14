import { useState } from 'react'
import clsx from 'clsx'
import { Tag, Check, Loader2, Search, Pencil } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import { useNaoClassificados, useCategorias, useLearnMerchant } from '../lib/api'
import { money, moneyShort, monthLabel } from '../theme/gap'

/**
 * Fila de classificacao.
 *
 * Um terco do gasto variavel fica sem categoria porque o extrato novo usa
 * descricoes diferentes das antigas ("Pg *Ze Delivery", "Cencosud Brasil
 * Comer"). Nao e erro de conta — e opacidade, e gasto opaco parece maior do
 * que e.
 *
 * Agrupa por LOJISTA de proposito: sao centenas de lancamentos orfaos, mas
 * poucas dezenas de lojistas. Uma escolha resolve todas as ocorrencias, e a
 * memoria e aplicada na leitura — entao o historico inteiro se recategoriza
 * na hora, sem reimportar nada.
 */
export default function ClassificarPage() {
  const [mes, setMes] = useState(null)
  const [reclassificar, setReclassificar] = useState(false)
  const { grupos, total, n, meses, isLoading } = useNaoClassificados({ mes, incluirClassificados: reclassificar })
  const categorias = useCategorias()
  const aprender = useLearnMerchant()

  const [busy, setBusy] = useState(null)
  const [filtro, setFiltro] = useState('')
  const [feitos, setFeitos] = useState([])

  const marcar = async (g, valor) => {
    if (!valor) return
    const [category, subcategory] = valor.split('|')
    setBusy(g.key)
    try {
      await aprender.mutateAsync({ key: g.key, category, subcategory: subcategory ?? null })
      setFeitos((f) => [...f, { label: g.label, cat: valor, cents: g.cents }])
    } catch { /* mostrado abaixo */ }
    finally { setBusy(null) }
  }

  const visiveis = filtro.trim()
    ? grupos.filter((g) => g.label.toLowerCase().includes(filtro.trim().toLowerCase()))
    : grupos

  // as 6 categorias mais usadas viram botao de 1 toque; o resto fica no select
  const rapidas = categorias.slice(0, 6)

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Classificar"
        subtitle="Uma escolha por lojista vale para todo o histórico, inclusive o que já foi importado."
        right={
          <div className="flex items-end gap-2">
            <div>
              <label className="gap-label">Fatura</label>
              <select
                className="gap-input text-base md:text-sm"
                value={mes ?? ''}
                onChange={(e) => setMes(e.target.value || null)}
              >
                <option value="">últimos 12 meses</option>
                {meses.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <button
              onClick={() => setReclassificar((r) => !r)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] border transition-colors',
                reclassificar
                  ? 'bg-gap-blue text-white border-gap-blue font-semibold'
                  : 'border-gap-border text-gap-muted hover:bg-gap-soft'
              )}
            >
              <Pencil size={13} />Reclassificar
            </button>
          </div>
        }
      />

      <KpiGrid
        items={[
          { label: 'Sem categoria', value: money(total), sub: mes ? `fatura de ${monthLabel(mes)}` : 'últimos 12 meses', tone: 'pos' },
          { label: 'Lojistas', value: String(grupos.length), sub: reclassificar ? 'todos' : `${n} sem categoria` },
          { label: 'Maior pendência', value: grupos[0] ? moneyShort(grupos[0].cents) : '—', sub: grupos[0]?.label?.slice(0, 22) ?? '' },
          { label: 'Resolvidos agora', value: String(feitos.length), sub: feitos.length ? money(feitos.reduce((a, f) => a + f.cents, 0)) : '—', tone: feitos.length ? 'neg' : undefined },
        ]}
      />

      {isLoading ? (
        <div className="gap-card p-6 mt-4 text-center text-gap-muted text-[12.5px]">
          <Loader2 size={22} className="mx-auto animate-spin mb-2" />
          carregando do GitHub…
        </div>
      ) : grupos.length === 0 ? (
        <div className="gap-card p-6 mt-4 text-center">
          <Check size={28} className="mx-auto text-gap-green mb-2" />
          <div className="text-[13px] font-semibold text-gap-navy">
            {reclassificar ? 'Nada nesse período' : 'Tudo classificado'}
          </div>
          <div className="text-[11.5px] text-gap-muted mt-1">
            {mes ? `Nenhum gasto órfão na fatura de ${monthLabel(mes)}.` : 'Nenhum gasto órfão nos últimos 12 meses.'}
          </div>
        </div>
      ) : (
        <>
          <div className="relative mt-4">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gap-muted" />
            <input
              className="gap-input w-full pl-8 text-base md:text-sm"
              placeholder="filtrar lojista…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 mt-3">
            {visiveis.map((g) => (
              <div
                key={g.key}
                className={clsx('gap-card p-3', busy === g.key && 'opacity-50 pointer-events-none')}
              >
                <div className="flex items-start gap-2">
                  <Tag size={13} className="text-gap-muted mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-gap-navy truncate" title={g.label}>
                      {g.label}
                    </div>
                    <div className="text-[11px] text-gap-muted">
                      {g.n} lançamento{g.n === 1 ? '' : 's'} · último {g.ultimo?.slice(8, 10)}/{g.ultimo?.slice(5, 7)}
                      {g.cat && <> · <span className="text-gap-blue font-semibold">{g.cat}{g.sub ? ` · ${g.sub}` : ''}</span></>}
                    </div>
                  </div>
                  <div className="num text-[13px] font-bold text-gap-navy whitespace-nowrap">
                    {money(g.cents)}
                  </div>
                  {busy === g.key && <Loader2 size={15} className="animate-spin text-gap-blue" />}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {rapidas.map((c) => (
                    <button
                      key={c}
                      onClick={() => marcar(g, c)}
                      className="text-[11.5px] border border-gap-border rounded-full px-2.5 py-1 hover:bg-[#eef6fd] hover:border-gap-blue active:bg-[#dceefc] transition-colors"
                    >
                      {c.replace('|', ' · ')}
                    </button>
                  ))}
                  <select
                    className="gap-input text-[11.5px] py-1 max-w-[46vw] md:max-w-[200px]"
                    defaultValue=""
                    onChange={(e) => marcar(g, e.target.value)}
                  >
                    <option value="" disabled>outra…</option>
                    {categorias.map((c) => <option key={c} value={c}>{c.replace('|', ' · ')}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {aprender.error && (
            <div className="mt-3 text-[12px] text-gap-red border border-gap-red/30 bg-gap-red/5 rounded-md px-2.5 py-2 whitespace-pre-line">
              {String(aprender.error.message ?? aprender.error)}
            </div>
          )}
        </>
      )}

      {feitos.length > 0 && (
        <div className="gap-card p-3.5 mt-4">
          <div className="text-[12px] font-semibold text-gap-navy mb-2">Classificados nesta sessão</div>
          {feitos.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px] py-0.5">
              <Check size={12} className="text-gap-green shrink-0" />
              <span className="truncate flex-1">{f.label}</span>
              <span className="text-gap-muted">{f.cat.replace('|', ' · ')}</span>
              <span className="num font-semibold">{money(f.cents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
