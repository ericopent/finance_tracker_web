import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { readFile, appendJsonl, rewriteJsonl, writeFile, parseJsonl, getToken } from './github'
import { monthView, cashflow, hydrate, merchantKey } from './engine'
import { todayISO } from './money'

// caminhos dentro do repo PRIVADO de dados
const P_LEDGER = 'data/ledger.json'
const P_CONFIG = 'data/config.json'
const P_MANUAL = 'data/manual.jsonl'

/**
 * Dataset completo, buscado uma vez e mantido em memoria.
 *
 * ledger.json e imutavel entre imports (334KB, ~32KB no fio), entao vale cache
 * longo. manual.jsonl muda a cada lancamento e e invalidado pelas mutations.
 */
export function useDataset() {
  return useQuery({
    queryKey: ['dataset'],
    enabled: !!getToken(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [ledger, config, manual] = await Promise.all([
        readFile(P_LEDGER),
        readFile(P_CONFIG),
        readFile(P_MANUAL),
      ])
      if (!ledger) throw new Error(`${P_LEDGER} não existe no repo — rode scripts/export_web.py e commite`)
      return {
        ledger: JSON.parse(ledger.text),
        config: config ? JSON.parse(config.text) : { recurring: [] },
        manual: parseJsonl(manual?.text ?? ''),
      }
    },
  })
}

/** Visao do mes — calculada no cliente a partir do dataset. */
export function useMonthView(date) {
  const q = useDataset()
  const today = date ?? todayISO()
  return {
    ...q,
    data: q.data ? monthView(q.data.ledger, q.data.config, q.data.manual, today) : undefined,
  }
}

export function useCashflow(horizon = 12, openingCents = 0) {
  const q = useDataset()
  const from = todayISO().slice(0, 7)
  return {
    ...q,
    data: q.data ? cashflow(q.data.ledger, q.data.config, q.data.manual, from, horizon, openingCents) : undefined,
  }
}

/** Autocomplete: lojistas do historico, mais usados primeiro, com a categoria. */
export function useSuggest(q) {
  const ds = useDataset()
  const term = (q ?? '').trim().toUpperCase()
  if (term.length < 2 || !ds.data) return []
  const key = merchantKey(term)
  const by = new Map()
  for (const t of hydrate(ds.data.ledger, ds.data.manual)) {
    if (t.kind !== 'purchase' || !t.mkey.includes(key)) continue
    const g = by.get(t.desc) ?? { description: t.desc, category: t.cat, subcategory: t.sub, last_cents: t.cents, uses: 0, last: '' }
    g.uses++
    if (t.date > g.last) { g.last = t.date; g.last_cents = t.cents; if (t.cat) { g.category = t.cat; g.subcategory = t.sub } }
    by.set(t.desc, g)
  }
  return [...by.values()].sort((a, b) => b.uses - a.uses || b.last.localeCompare(a.last)).slice(0, 8)
}

// ---------------------------------------------------------------- escrita

function useDatasetMutation(fn) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dataset'] }),
  })
}

export function useAddTxn() {
  return useDatasetMutation(async (t) => {
    const entry = {
      // id local: nao precisa ser global, so unico o bastante pra apagar depois
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      date: t.posted_on ?? todayISO(),
      desc: t.description.trim(),
      mkey: merchantKey(t.description),
      cents: t.cents,
      cat: t.category ?? null,
      sub: t.subcategory ?? null,
      at: new Date().toISOString(),
    }
    await appendJsonl(P_MANUAL, entry, `gasto: ${entry.desc} ${(entry.cents / 100).toFixed(2)}`)
    return entry
  })
}

export function useDeleteTxn() {
  return useDatasetMutation((id) =>
    rewriteJsonl(P_MANUAL, (o) => o.id !== id, `remove lançamento ${id}`)
  )
}

/** Grava config.json inteiro (poucos KB) com o sha corrente. */
async function saveConfig(mutate, message) {
  const cur = await readFile(P_CONFIG)
  const cfg = cur ? JSON.parse(cur.text) : { recurring: [] }
  mutate(cfg)
  await writeFile(P_CONFIG, JSON.stringify(cfg, null, 2), cur?.sha, message)
}

export function useConfirmRecurring() {
  return useDatasetMutation((item) =>
    saveConfig((cfg) => {
      cfg.recurring = cfg.recurring.filter((r) => r.key !== item.key)
      cfg.recurring.push({
        id: Date.now(), label: item.label, direction: 'outflow', cents: item.cents,
        category: item.category ?? null, day: null, key: item.key,
        active: true, confirmed: true,
      })
    }, `recorrente: ${item.label}`)
  )
}

export function useDismissRecurring() {
  return useDatasetMutation((key) =>
    saveConfig((cfg) => {
      cfg.recurring = cfg.recurring.filter((r) => r.key !== key)
      // registro inativo = "ja decidi que nao e recorrente, para de sugerir"
      cfg.recurring.push({
        id: Date.now(), label: key, direction: 'outflow', cents: 0,
        category: null, day: null, key, active: false, confirmed: false,
      })
    }, `não é recorrente: ${key}`)
  )
}
