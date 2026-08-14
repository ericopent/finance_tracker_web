import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  readFile, appendJsonl, rewriteJsonl, updateJson, putJson, parseJsonl, listDir, getToken,
} from './github'
import { monthView, cashflow, hydrate, merchantKey, monthAdd } from './engine'
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
  // Comeca na PROXIMA fatura, nao no mes corrente: a fatura deste mes vence dia
  // 5, entao em qualquer dia depois disso ela ja saiu da conta e nao e mais
  // dinheiro a sair. Projetar a partir dela contava um pagamento que ja ocorreu.
  const from = monthAdd(todayISO().slice(0, 7), 1)
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
  for (const t of hydrate(ds.data.ledger, ds.data.manual, ds.data.statements, ds.data.config)) {
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
  for (const t of hydrate(ds.data.ledger, ds.data.manual, ds.data.statements, ds.data.config)) {
    if (!t.cat) continue
    const k = t.sub ? `${t.cat}|${t.sub}` : t.cat
    set.set(k, (set.get(k) ?? 0) + 1)
  }
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/**
 * Gastos sem categoria, agrupados por lojista.
 *
 * Agrupar importa: sao ~700 lancamentos orfaos, mas poucas dezenas de lojistas.
 * Uma decisao resolve todas as ocorrencias, passadas e futuras. Ordenado por
 * valor pra voce atacar o que move o ponteiro primeiro.
 */
export function useNaoClassificados(meses = 12) {
  const ds = useDataset()
  if (!ds.data) return { grupos: [], total: 0, n: 0 }
  const txns = hydrate(ds.data.ledger, ds.data.manual, ds.data.statements, ds.data.config)
  const cortes = [...new Set(txns.map((t) => t.cash))].sort().slice(-meses)
  const janela = new Set(cortes)

  const by = new Map()
  let total = 0
  let n = 0
  for (const t of txns) {
    if (t.kind !== 'purchase' || t.cat || !t.mkey || !janela.has(t.cash)) continue
    const g = by.get(t.mkey) ?? { key: t.mkey, label: t.desc, n: 0, cents: 0, ultimo: '', exemplos: [] }
    g.n++
    g.cents += t.cents
    if (t.date > g.ultimo) { g.ultimo = t.date; g.label = t.desc }
    if (g.exemplos.length < 3) g.exemplos.push(t.desc)
    by.set(t.mkey, g)
    total += t.cents
    n++
  }
  return {
    grupos: [...by.values()].sort((a, b) => b.cents - a.cents),
    total,
    n,
  }
}

/** Ensina a categoria de um lojista — vale retroativo, pra todo o histórico. */
export function useLearnMerchant() {
  return useDatasetMutation(({ key, category, subcategory }) =>
    saveConfig((cfg) => {
      cfg.memory[key] = [category, subcategory ?? null]
    }, `classifica ${key} como ${category}`)
  )
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

/**
 * Grava o config.json. Delega o le-muta-grava pro github.js, que serializa por
 * arquivo e faz retry — dois toques seguidos batiam 409 de sha.
 *
 * As mutacoes abaixo sao "filtra e insere" de proposito: em conflito o arquivo
 * e relido e a mutacao REAPLICADA, entao ela precisa dar o mesmo resultado
 * rodando duas vezes.
 */
function saveConfig(mutate, message) {
  return updateJson(P_CONFIG, (cfg) => {
    cfg.recurring ??= []
    cfg.memory ??= {}
    cfg.rules ??= []
    mutate(cfg)
  }, message, { recurring: [], rules: [], memory: {} })
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

/** Remove de vez um recorrente (usado quando o lojista mudou de nome). */
export function useRemoveRecurring() {
  return useDatasetMutation((key) =>
    saveConfig((cfg) => {
      cfg.recurring = cfg.recurring.filter((r) => r.key !== key)
    }, `remove recorrente ${key}`)
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
    const body = { ref, generated: new Date().toISOString(), txns }
    await putJson(path, body, `fatura ${ref} (${txns.length} lançamentos)`)

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
