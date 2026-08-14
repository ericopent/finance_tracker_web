import { useState, useRef, useEffect } from 'react'
import { Plus, CornerDownLeft } from 'lucide-react'
import { useSuggest, useAddTxn } from '../lib/api'
import { parseMoney, todayISO } from '../lib/money'
import { money } from '../theme/gap'

/**
 * Linha de lancamento rapido.
 *
 * O objetivo e que anotar um gasto custe ~2 segundos, senao ninguem mantem o
 * habito: campo sempre focado, Enter envia, autocomplete puxa a categoria do
 * historico (3.121 lancamentos) pra nao ter que escolher no dropdown.
 */
export default function QuickEntry() {
  const [valor, setValor] = useState('')
  const [desc, setDesc] = useState('')
  const [data, setData] = useState(todayISO())
  const [cat, setCat] = useState(null)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [erro, setErro] = useState(null)

  const valorRef = useRef(null)
  const sugs = useSuggest(desc)
  const add = useAddTxn()

  // atalho de teclado so faz sentido no desktop; no celular o alvo e o polegar
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'n' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        valorRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (s) => {
    setDesc(s.description)
    setCat({ category: s.category, subcategory: s.subcategory })
    setOpen(false)
  }

  const submit = async () => {
    const cents = parseMoney(valor)
    if (!cents) { setErro('valor inválido'); valorRef.current?.focus(); return }
    if (!desc.trim()) { setErro('descrição vazia'); return }
    setErro(null)
    try {
      await add.mutateAsync({
        description: desc.trim(),
        cents,
        posted_on: data,
        category: cat?.category ?? null,
        subcategory: cat?.subcategory ?? null,
      })
      setValor(''); setDesc(''); setCat(null); setOpen(false)
      valorRef.current?.focus()
    } catch (e) {
      setErro(String(e))
    }
  }

  const onDescKey = (e) => {
    if (!open || sugs.length === 0) {
      if (e.key === 'Enter') submit()
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, sugs.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sugs[hi]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const preview = parseMoney(valor)

  return (
    <div className="gap-card px-3.5 py-3">
      {/* celular: grade 2 col (valor|data, onde, botão). desktop: uma linha só.
          ordem do DOM segue o celular; md:order-* recoloca no desktop. */}
      <div className="grid grid-cols-2 gap-2.5 md:flex md:items-end">
        <div className="md:order-1 md:w-[130px]">
          <label className="gap-label">Valor</label>
          <input
            ref={valorRef}
            className="gap-input w-full num text-base md:text-sm"
            placeholder="89,90"
            value={valor}
            inputMode="decimal"
            enterKeyHint="done"
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="md:order-3 md:w-[150px]">
          <label className="gap-label">Data</label>
          <input
            type="date"
            className="gap-input w-full num text-base md:text-sm"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>

        <div className="relative col-span-2 md:order-2 md:col-span-1 md:flex-1">
          <label className="gap-label">Onde</label>
          <input
            className="gap-input w-full text-base md:text-sm"
            placeholder="começa a digitar…"
            value={desc}
            enterKeyHint="done"
            onChange={(e) => { setDesc(e.target.value); setCat(null); setOpen(true); setHi(0) }}
            onKeyDown={onDescKey}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => desc.length >= 2 && setOpen(true)}
          />
          {open && sugs.length > 0 && (
            <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gap-border rounded-lg shadow-lg overflow-hidden max-h-[46vh] overflow-y-auto">
              {sugs.map((s, i) => (
                <li
                  key={s.description}
                  onMouseDown={(e) => { e.preventDefault(); pick(s) }}
                  onMouseEnter={() => setHi(i)}
                  className={`px-2.5 py-2 md:py-1.5 text-[13px] md:text-[12.5px] cursor-pointer flex justify-between gap-3 ${i === hi ? 'bg-[#eef6fd]' : ''}`}
                >
                  <span className="truncate">{s.description}</span>
                  <span className="text-gap-muted whitespace-nowrap text-[11.5px]">
                    {s.category ?? '—'} · {money(s.last_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          className="gap-btn col-span-2 md:order-4 md:col-span-1 md:w-auto flex items-center justify-center gap-1.5 py-2.5 md:py-1.5"
          onClick={submit}
          disabled={add.isPending}
        >
          <Plus size={15} />{add.isPending ? 'salvando…' : 'Lançar'}
        </button>
      </div>

      <div className="flex items-center gap-3 mt-2 text-[11px] text-gap-muted min-h-[16px]">
        {erro
          ? <span className="text-gap-red font-semibold">{erro}</span>
          : <>
              {preview ? <span className="num">{money(preview)}</span> : null}
              {cat?.category && <span>categoria: <b>{cat.category}{cat.subcategory ? ` · ${cat.subcategory}` : ''}</b></span>}
              <span className="ml-auto flex items-center gap-1">
                <kbd className="px-1 py-px border border-gap-border rounded bg-gap-soft">n</kbd> foca ·
                <CornerDownLeft size={11} /> lança
              </span>
            </>}
      </div>
    </div>
  )
}
