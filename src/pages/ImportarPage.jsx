import { useState, useRef } from 'react'
import clsx from 'clsx'
import { Upload, FileText, Check, AlertTriangle, Loader2, Link2, ArrowLeft } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import KpiGrid from '../components/KpiGrid'
import GapTable from '../components/GapTable'
import { useDataset, useSaveStatement, useCategorias } from '../lib/api'
import { parseCsv, buildStatement, reconcile, refMonthFromName } from '../lib/import'
import { money, monthLabel } from '../theme/gap'

/**
 * Le o arquivo e devolve a grade CRUA — quem acha o cabecalho e o locateTable,
 * porque o XLSX do Itau tem 13 linhas de preambulo antes da tabela.
 * A lib de xlsx (~429KB) so baixa se voce escolher um Excel de verdade.
 */
async function lerArquivo(file) {
  const nome = file.name.toLowerCase()
  if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
    return { grid: parseCsv(await file.text()), sheetName: null }
  }
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const nomeAba = wb.SheetNames[0]
    const sh = wb.Sheets[nomeAba]
    // raw:false formata a celula como o Excel mostra; datas viram texto legivel
    const grid = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' })
    return { grid, sheetName: nomeAba }
  }
  throw new Error(`Formato não suportado: ${file.name}. Use .csv ou .xlsx.`)
}

export default function ImportarPage() {
  const ds = useDataset()
  const salvar = useSaveStatement()
  const categorias = useCategorias()
  const inputRef = useRef(null)

  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState(null)
  const [prev, setPrev] = useState(null) // { ref, txns, problemas, pares, soltos, fileName }
  const [pronto, setPronto] = useState(null)

  const abrir = async (file) => {
    if (!file) return
    setErro(null); setPronto(null); setLendo(true)
    try {
      const { grid, sheetName } = await lerArquivo(file)
      const st = buildStatement({
        grid, config: ds.data?.config, fileName: file.name, sheetName,
      })
      const doMes = (ds.data?.manual ?? []).filter(
        (m) => m.date >= `${st.ref}-01` || m.date.slice(0, 7) >= mesAnterior(st.ref)
      )
      const { pares, soltos } = reconcile(st.txns, doMes)
      setPrev({ ...st, pares, soltos, fileName: file.name })
    } catch (e) {
      setErro(String(e.message ?? e))
    } finally {
      setLendo(false)
    }
  }

  const setCat = (i, valor) => {
    setPrev((p) => {
      const txns = [...p.txns]
      const [cat, sub] = valor.split('|')
      txns[i] = { ...txns[i], cat: cat || null, sub: sub || null, via: 'manual' }
      return { ...p, txns }
    })
  }

  const confirmar = async () => {
    // so o que voce classificou na mao vira memoria — regra e memoria antiga
    // ja acertaram sozinhas e nao precisam ser reescritas
    const aprendidos = {}
    for (const t of prev.txns) {
      if (t.via === 'manual' && t.cat && t.mkey) aprendidos[t.mkey] = [t.cat, t.sub ?? null]
    }
    const limpar = prev.txns.map(() => null) // placeholder p/ clareza
    void limpar
    const r = await salvar.mutateAsync({
      ref: prev.ref,
      txns: prev.txns.map(({ via, ...t }) => t), // `via` e so da UI
      aprendidos,
      reconciliados: prev.pares.map((p) => p.manual.id),
    })
    setPronto(r)
    setPrev(null)
  }

  if (ds.isLoading) return <div className="p-6 text-gap-muted text-sm">carregando…</div>

  const semCat = prev ? prev.txns.map((t, i) => ({ ...t, i })).filter((t) => t.kind === 'purchase' && !t.cat) : []
  const compras = prev ? prev.txns.filter((t) => t.kind === 'purchase') : []
  const total = compras.reduce((a, t) => a + t.cents, 0)
  const jaExiste = prev && (ds.data?.statements ?? []).some((s) => s.ref === prev.ref)

  return (
    <div className="p-5 max-w-[1080px] mx-auto">
      <PageHeader
        title="Importar fatura"
        subtitle="Lê o arquivo aqui no aparelho, classifica pelo seu histórico e grava no repositório privado."
      />

      {pronto && (
        <div className="gap-card p-3.5 border-l-4 border-l-gap-green mb-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-gap-navy">
            <Check size={15} className="text-gap-green" />
            Fatura de {monthLabel(pronto.ref)} salva — {pronto.n} lançamentos.
          </div>
        </div>
      )}

      {!prev && (
        <div className="gap-card p-6 text-center">
          <input
            ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
            onChange={(e) => { abrir(e.target.files?.[0]); e.target.value = '' }}
          />
          <Upload size={30} className="mx-auto text-gap-muted mb-2" />
          <div className="text-[13px] font-semibold text-gap-navy mb-1">Escolha o arquivo da fatura</div>
          <div className="text-[11.5px] text-gap-muted mb-4">
            CSV ou Excel. No celular dá pra pegar de Arquivos, iCloud ou Drive.
          </div>
          <button className="gap-btn" onClick={() => inputRef.current?.click()} disabled={lendo}>
            {lendo ? <Loader2 size={15} className="animate-spin inline" /> : 'Escolher arquivo'}
          </button>
          {erro && (
            <div className="mt-4 text-[12px] text-gap-red border border-gap-red/30 bg-gap-red/5 rounded-md px-2.5 py-2 whitespace-pre-line text-left">
              {erro}
            </div>
          )}
          {(ds.data?.statements ?? []).length > 0 && (
            <div className="mt-5 pt-4 border-t border-gap-border text-left">
              <div className="text-[11px] uppercase tracking-wide text-gap-muted mb-1.5">Já importadas pelo app</div>
              <div className="flex flex-wrap gap-1.5">
                {[...(ds.data.statements ?? [])].sort((a, b) => b.ref.localeCompare(a.ref)).map((s) => (
                  <span key={s.ref} className="text-[11.5px] bg-gap-soft border border-gap-border rounded px-2 py-0.5">
                    {monthLabel(s.ref)} · {s.txns.length}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {prev && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button className="text-gap-muted hover:text-gap-navy" onClick={() => setPrev(null)} title="voltar">
              <ArrowLeft size={16} />
            </button>
            <FileText size={14} className="text-gap-muted" />
            <span className="text-[12.5px] text-gap-muted">{prev.fileName}</span>
          </div>

          <KpiGrid
            items={[
              { label: 'Mês da fatura', value: monthLabel(prev.ref) },
              { label: 'Lançamentos', value: String(prev.txns.length) },
              { label: 'Total de compras', value: money(total), tone: 'pos' },
              { label: 'Sem categoria', value: String(semCat.length), tone: semCat.length ? 'pos' : undefined },
              { label: 'Reconciliados', value: String(prev.pares.length), sub: `${prev.soltos.length} sem par` },
            ]}
          />

          {jaExiste && (
            <div className="gap-card p-3 mt-3 border-l-4 border-l-[#f59e0b] text-[12px]">
              <b>{monthLabel(prev.ref)} já foi importada.</b> Confirmar substitui a versão anterior —
              não duplica.
            </div>
          )}

          {prev.problemas.length > 0 && (
            <div className="gap-card p-3 mt-3 border-l-4 border-l-gap-red">
              <div className="text-[12px] font-semibold text-gap-red flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} /> {prev.problemas.length} linha(s) ilegível(is), ignorada(s)
              </div>
              {prev.problemas.slice(0, 4).map((p) => (
                <div key={p.linha} className="text-[11px] text-gap-muted">linha {p.linha}: {p.raw}</div>
              ))}
            </div>
          )}

          {prev.pares.length > 0 && (
            <div className="gap-card p-3.5 mt-3">
              <div className="text-[12px] font-semibold text-gap-navy mb-1 flex items-center gap-1.5">
                <Link2 size={13} className="text-gap-blue" />
                Casaram com o que você lançou na mão
              </div>
              <div className="text-[11px] text-gap-muted mb-2">
                Ao confirmar, o lançamento manual é removido e vale o da fatura — senão o gasto contaria duas vezes.
              </div>
              <GapTable
                wrap maxHeight={200}
                columns={[
                  { key: 'm', label: 'Você lançou', align: 'left', fmt: (_, r) => `${r.manual.desc} · ${r.manual.date.slice(8, 10)}/${r.manual.date.slice(5, 7)}` },
                  { key: 'f', label: 'Na fatura', align: 'left', fmt: (_, r) => r.fatura.desc },
                  { key: 'v', label: 'Valor', align: 'right', fmt: (_, r) => money(r.fatura.cents) },
                ]}
                rows={prev.pares}
              />
            </div>
          )}

          {semCat.length > 0 && (
            <div className="gap-card p-3.5 mt-3">
              <div className="text-[12px] font-semibold text-gap-navy mb-1">
                Classificar {semCat.length} lançamento(s)
              </div>
              <div className="text-[11px] text-gap-muted mb-2">
                O que você escolher aqui entra na memória — no mês que vem já vem classificado sozinho.
              </div>
              <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto">
                {semCat.map((t) => (
                  <div key={t.i} className="flex items-center gap-2 border border-gap-border rounded-md px-2.5 py-1.5">
                    <span className="truncate flex-1 text-[12.5px]" title={t.desc}>{t.desc}</span>
                    <span className="num text-[12px] font-semibold whitespace-nowrap">{money(t.cents)}</span>
                    <select
                      className="gap-input text-[12px] py-1 max-w-[42vw] md:max-w-[220px]"
                      defaultValue=""
                      onChange={(e) => setCat(t.i, e.target.value)}
                    >
                      <option value="" disabled>categoria…</option>
                      {categorias.map((c) => <option key={c} value={c}>{c.replace('|', ' · ')}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button className="gap-btn" onClick={confirmar} disabled={salvar.isPending}>
              {salvar.isPending
                ? <><Loader2 size={15} className="animate-spin inline mr-1.5" />gravando…</>
                : `Confirmar e gravar ${monthLabel(prev.ref)}`}
            </button>
            <button className="text-[12.5px] text-gap-muted hover:text-gap-navy" onClick={() => setPrev(null)}>
              cancelar
            </button>
            {semCat.length > 0 && (
              <span className="text-[11.5px] text-gap-muted">
                pode gravar com pendências — dá pra classificar depois
              </span>
            )}
          </div>

          {salvar.error && (
            <div className="mt-3 text-[12px] text-gap-red border border-gap-red/30 bg-gap-red/5 rounded-md px-2.5 py-2 whitespace-pre-line">
              {String(salvar.error.message ?? salvar.error)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function mesAnterior(ref) {
  const t = Number(ref.slice(0, 4)) * 12 + (Number(ref.slice(5, 7)) - 1) - 1
  return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}`
}
