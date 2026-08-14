import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  readFile, writeFile, appendJsonl, rewriteJsonl, parseJsonl, listDir, getToken,
} from './github'
import { monthView, cashflow, hydrate, merchantKey } from './engine'
import { todayISO } from './money'

// caminhos dentro do repo PRIVADO de dados
const P_LEDGER = 'data/ledger.json'
const P_CONFIG = 'data/config.json'
const P_MANUAL = 'data/manual.jsonl'
const D_STMT = 'data/statements'

/**
 * Dataset completo.
 *
 * ledger.json e o baseline do backfill e nao muda; as faturas importadas pelo
 * app viram arquivos separados em data/statements/. Ler os dois e juntar sai
 * mais barato que reescrever 334KB a cada import — e impede que rodar o
 * export_web.py de novo apague o que foi importado pelo celular.
 */
export function useDataset() {
  return useQuery({
    queryKey: ['dataset'],
    enabled: !!getToken(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [ledger, config, manual, stmtFiles] = await Promise.all([
        readFile(P_LEDGER),
        readFile(P_CONFIG),
        readFile(P_MANUAL),
        listDir(D_STMT),
      ])
      if (!ledger) {
        throw new Error(`${P_LEDGER} não existe no repo.\nRode scripts/export_web.py e commite.`)
      }
      const statements = (
        await Promise.all(
          (stmtFiles ?? [])
            .filter((f) => f.name.endsWith('.json'))
            .map((f) => readFile(`${D_STMT}/${f.name}`).then((r) => (r ? JSON.parse(r.text) : null)))
        )
      ).filter(Boolean)

      return {
        ledger: JSON.parse(ledger.text),
        config: config ? JSON.parse(config.text) : { recurring: [], rules: [], memory: {} },
        manual: parseJsonl(manual?.text ?? ''),
        statements,
      }
    },
  })
}

/**
 * Visao do mes. O calculo roda DURANTE o render, entao uma excecao aqui
 * derrubaria a arvore — capturando, o problema aparece na tela.
 */
export function useMonthView(date) {
  const q = useDataset()
  const today = date ?? todayISO()
  let data
  let calcError = null
  if (q.data) {
    try {
      data = monthView(q.data, today)
    } catch (e) {
      calcError = e instanceof Error ? e : new Error(String(e))
      calcError.message = `falha ao calcular o mês: ${calcError.message}`
    }
  }
  return { ...q, data, error: q.error ?? calcError }
}

export function useCashflow(horizon = 12, openingCents = 0) {
  const q = useDataset()
  const from = todayISO().slice(0, 7)
  let data
  let calcError = null
  if (q.data) {
    try {
      data = cashflow(q.data, from, horizon, openingCents)
    } catch (e) {
      calcError = e instanceof Error ? e : new Error(String(e))
    }
  }
  return { ...q, data, error: q.error ?? calcError }
}

/** Autocomplete: lojistas do historico, mais usados primeiro, com a categoria. */
export function useSuggest(q) {
  const ds = useDataset()
  const term = (q ?? '').trim().toUpperCase()
  if (term.length < 2 || !ds.data) return []
  const key = merchantKey(term)
  const by = new Map()
  for (const t of hydrate(ds.data.ledger, ds.data.manual, ds.data.statements)) {
    if (t.kind !== 'purchase' || !t.mkey.includes(key)) continue
    const g = by.get(t.desc) ?? {
      description: t.desc, category: t.cat, subcategory: t.sub,
      last_cents: t.cents, uses: 0, last: '',
    }
    g.uses++
    if (t.date > g.last) {
      g.last = t.date
      g.last_cents = t.cents
      if (t.cat) { g.category = t.cat; g.subcategory = t.sub }
    }
    by.set(t.desc, g)
  }
  return [...by.values()]
    .sort((a, b) => b.uses - a.uses || b.last.localeCompare(a.last))
    .slice(0, 8)
}

/** Categorias ja usadas — alimenta os seletores da revisao de import. */
export function useCategorias() {
  const ds = useDataset()
  if (!ds.data) return []
  const set = new Map()
  for (const t of hydrate(ds.data.ledger, ds.data.manual, ds.data.statements)) {
    if (!t.cat) continue
    const k = t.sub ? `${t.cat}|${t.sub}` : t.cat
    set.set(k, (set.get(k) ?? 0) + 1)
  }
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
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

/** Le, muta e grava o config.json com o sha corrente. */
async function saveConfig(mutate, message) {
  const cur = await readFile(P_CONFIG)
  const cfg = cur ? JSON.parse(cur.text) : { recurring: [], rules: [], memory: {} }
  cfg.recurring ??= []
  cfg.memory ??= {}
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
      cfg.recurring.push({
        id: Date.now(), label: key, direction: 'outflow', cents: 0,
        category: null, day: null, key, active: false, confirmed: false,
      })
    }, `não é recorrente: ${key}`)
  )
}

/**
 * Grava a fatura importada + o que foi aprendido + limpa os manuais casados.
 *
 * Tres escritas, nesta ordem de proposito: se a segunda ou terceira falhar, a
 * fatura ja esta salva e reimportar e idempotente (sobrescreve o mesmo arquivo).
 * Ordem invertida perderia o import inteiro por causa de um erro de rede no fim.
 */
export function useSaveStatement() {
  return useDatasetMutation(async ({ ref, txns, aprendidos, reconciliados }) => {
    const path = `${D_STMT}/${ref}.json`
    const cur = await readFile(path)
    const body = { ref, generated: new Date().toISOString(), txns }
    await writeFile(path, JSON.stringify(body), cur?.sha, `fatura ${ref} (${txns.length} lançamentos)`)

    if (aprendidos && Object.keys(aprendidos).length) {
      await saveConfig((cfg) => {
        for (const [k, v] of Object.entries(aprendidos)) cfg.memory[k] = v
      }, `aprende ${Object.keys(aprendidos).length} lojista(s) da fatura ${ref}`)
    }

    if (reconciliados?.length) {
      const ids = new Set(reconciliados)
      await rewriteJsonl(P_MANUAL, (o) => !ids.has(o.id),
        `reconcilia ${ids.size} lançamento(s) com a fatura ${ref}`)
    }
    return { ref, n: txns.length }
  })
}
