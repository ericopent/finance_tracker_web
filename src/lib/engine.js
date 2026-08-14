/**
 * Motor de projecao — roda no navegador do celular.
 *
 * Porte 1:1 do que estava em Rust (app/src-tauri/src/forecast.rs). Sem servidor,
 * a conta acontece no cliente; o dataset chega compacto de data/ledger.json.
 *
 * Tres blocos, de naturezas diferentes de proposito:
 *   1. PARCELAS       deterministico  — base CAIXA (mes da fatura)
 *   2. RECORRENTES    quase det.      — detectados + confirmados pelo usuario
 *   3. DISCRICIONARIO estocastico     — base COMPETENCIA (data da compra)
 *
 * Cuidado central: linha parcelada repete a data ORIGINAL da compra em TODAS as
 * parcelas. Somar parcela por data de compra joga as 12 no mes 1 — por isso o
 * bloco 1 usa cash_month e os blocos 2-3 excluem parcelado.
 */

export const LOOKBACK_MONTHS = 6
export const MIN_MONTHS_PRESENT = 5
export const MAX_CV = 0.15
const MIN_MONTHS_CAND = 3
const MAX_CV_CAND = 0.40
const MIN_CENTS_CAND = 2000

// ---------------------------------------------------------------- meses

export function monthAdd(m, k) {
  const y = Number(m.slice(0, 4))
  const mo = Number(m.slice(5, 7))
  const t = y * 12 + (mo - 1) + k
  const yy = Math.floor(t / 12)
  const mm = ((t % 12) + 12) % 12
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`
}

export function monthDiff(from, to) {
  const p = (m) => Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1)
  return p(to) - p(from)
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// ---------------------------------------------------------------- estatistica

/** Percentil com interpolacao linear. Espera array JA ordenado. */
export function pct(sorted, p) {
  if (!sorted.length) return 0
  if (sorted.length === 1) return sorted[0]
  const i = p * (sorted.length - 1)
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

function cvOf(vals) {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  if (mean <= 0) return Infinity
  const varr = vals.reduce((a, x) => a + (x - mean) ** 2, 0) / vals.length
  return Math.sqrt(varr) / mean
}

// ---------------------------------------------------------------- hidratacao

const KIND = { p: 'purchase', y: 'payment', r: 'refund', f: 'fee', i: 'interest', n: 'income' }

/** Sinal num lugar so — espelha a view v_txn_signed do SQLite. */
export function outflow(kind, cents) {
  switch (kind) {
    case 'purchase':
    case 'fee':
    case 'interest':
      return cents
    case 'refund':
    case 'income':
      return -cents
    case 'payment':
      return 0 // pagamento de fatura NAO e gasto
    default:
      return cents
  }
}

/**
 * ledger.json (baseline) + statements importados + manual.jsonl -> objetos.
 *
 * Fatura importada pelo app SUBSTITUI o mesmo mes do baseline em vez de somar.
 * Sem isso, reimportar um mes que ja veio do backfill contaria tudo duas vezes.
 */
export function hydrate(ledger, manual = [], statements = []) {
  const substituidos = new Set(statements.map((s) => s.ref))
  const out = (ledger?.txns ?? [])
    .filter((r) => !substituidos.has(r[10]))
    .map((r) => ({
    date: r[0],
    desc: r[1],
    mkey: r[2],
    cents: r[3],
    kind: KIND[r[4]] ?? 'purchase',
    cat: r[5],
    sub: r[6],
    ino: r[7],
    itot: r[8],
    igrp: r[9] == null ? null : (ledger.groups?.[r[9]] ?? String(r[9])),
    cash: r[10],
    source: 'import',
  }))

  // faturas importadas pelo app: ja vem no formato de objeto
  for (const st of statements) {
    for (const t of st.txns ?? []) out.push({ ...t, source: 'import' })
  }

  for (const m of manual) {
    out.push({
      date: m.date,
      desc: m.desc,
      mkey: m.mkey ?? merchantKey(m.desc),
      cents: m.cents,
      kind: 'purchase',
      cat: m.cat ?? null,
      sub: m.sub ?? null,
      ino: null,
      itot: null,
      igrp: null,
      cash: m.date.slice(0, 7), // sem fatura: caixa = competencia
      source: 'manual',
      id: m.id,
    })
  }
  return out
}

/** Espelha scripts/backfill.py::merchant_key — tem que casar, senao o
 *  autocomplete e a memoria nao encontram o lancamento feito no celular. */
export function merchantKey(desc) {
  return String(desc ?? '')
    .normalize('NFKD')
    // marcas de acento soltas pelo NFKD. Escapado de proposito: com os
    // caracteres combinantes crus, qualquer ferramenta que reencode o arquivo
    // corrompe a classe em silencio.
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s*\d{2}\/\d{2}\s*$/, '')
    .replace(/[*#]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------- 1. parcelas

export function installmentsDue(txns, lastStatement, target) {
  if (!lastStatement) return []
  const k = monthDiff(lastStatement, target)
  if (k < 0) return []
  return txns
    .filter((t) => t.cash === lastStatement && t.igrp != null && t.itot != null && t.ino != null)
    .map((t) => ({ ...t, remaining: t.itot - t.ino }))
    .filter((t) => k <= t.remaining)
    .map((t) => ({
      label: t.desc,
      cents: t.cents,
      number: t.ino + k,
      total: t.itot,
      remaining: t.remaining,
      category: t.cat,
    }))
    .sort((a, b) => b.cents - a.cents)
}

export function installmentRunoff(txns, lastStatement, from, horizon = 12) {
  const out = []
  for (let k = 0; k < horizon; k++) {
    const m = monthAdd(from, k)
    const due = installmentsDue(txns, lastStatement, m)
    out.push({ month: m, cents: due.reduce((a, i) => a + i.cents, 0), count: due.length })
  }
  return out
}

// ---------------------------------------------------------------- 2. recorrentes

/** Estatistica por lojista na janela recente. Exclui parcelado sempre —
 *  parcela e tratada no bloco 1, contar aqui seria contar duas vezes. */
function merchantStats(txns, lastStatement, minMonths) {
  if (!lastStatement) return []
  const floor = monthAdd(lastStatement, -(LOOKBACK_MONTHS - 1))
  const by = new Map()
  for (const t of txns) {
    if (t.kind !== 'purchase' || t.igrp != null || t.cash < floor) continue
    let g = by.get(t.mkey)
    if (!g) { g = { key: t.mkey, months: new Set(), vals: [], label: t.desc, cat: t.cat }; by.set(t.mkey, g) }
    g.months.add(t.cash)
    g.vals.push(t.cents)
    if (t.cat && !g.cat) g.cat = t.cat
  }
  const out = []
  for (const g of by.values()) {
    if (g.months.size < minMonths || !g.vals.length) continue
    const sorted = [...g.vals].sort((a, b) => a - b)
    out.push({
      key: g.key, label: g.label, category: g.cat ?? null,
      months: g.months.size, median: Math.round(pct(sorted, 0.5)), cv: cvOf(g.vals),
    })
  }
  return out
}

/** Recorrentes que dispensam confirmacao: quase todo mes e valor estavel. */
export function detectSubscriptions(txns, lastStatement) {
  return merchantStats(txns, lastStatement, MIN_MONTHS_PRESENT)
    .filter((s) => s.cv <= MAX_CV)
    .map((s) => ({ ...s, cents: s.median, months_seen: s.months, declared: false }))
    .sort((a, b) => b.cents - a.cents)
}

/**
 * Candidatos que a regra estrita perde.
 *
 * 5-em-6-meses e cega pra assinatura NOVA: CLAUDE.AI (R$ 582/mes, cv 0.03) so
 * tem 4 meses e ficaria fora do travado, subdeclarando o mes em centenas de
 * reais. Aqui a barra e mais baixa e a decisao volta pro usuario.
 */
export function detectCandidates(txns, lastStatement, config) {
  const decided = new Set((config?.recurring ?? []).map((r) => r.key).filter(Boolean))
  return merchantStats(txns, lastStatement, MIN_MONTHS_CAND)
    .filter((s) => !(s.months >= MIN_MONTHS_PRESENT && s.cv <= MAX_CV)) // ja travado
    .filter((s) => s.cv <= MAX_CV_CAND && s.median >= MIN_CENTS_CAND)
    .filter((s) => s.key && !decided.has(s.key))
    .map((s) => ({ ...s, cents: s.median, months_seen: s.months, declared: false }))
    .sort((a, b) => b.cents - a.cents)
}

export function declaredRecurring(config, direction) {
  return (config?.recurring ?? [])
    .filter((r) => r.active && r.direction === direction)
    .map((r) => ({ ...r, label: r.label, cents: r.cents, declared: true, months_seen: 0, cv: 0 }))
    .sort((a, b) => b.cents - a.cents)
}

// ---------------------------------------------------------------- 3. discricionario

/**
 * Totais mensais do gasto variavel — nem parcela, nem recorrente.
 *
 * Agrupa por CASH month (mes da fatura), nao por data de compra. As duas
 * medem a mesma coisa ("um mes de gasto variavel"), mas a janela da fatura e
 * completa por construcao, enquanto o mes-calendario e cortado pelo
 * fechamento: fev/26 dava R$ 1.371 e mar/26 R$ 20.105, quando pela fatura sao
 * R$ 9.292 e R$ 11.466. Puro artefato de borda, que inflava a faixa de
 * incerteza em 66% (p90-p10 caiu de R$ 8.041 pra R$ 4.832).
 */
function discretionaryHistory(txns, exclude, currentMonth, months = 12) {
  const ex = new Set(exclude)
  const by = new Map()
  for (const t of txns) {
    if (t.igrp != null || t.kind === 'payment' || ex.has(t.mkey)) continue
    const m = t.cash ?? t.date.slice(0, 7)
    if (m >= currentMonth) continue // mes em curso e parcial
    by.set(m, (by.get(m) ?? 0) + outflow(t.kind, t.cents))
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-months).map(([, v]) => v)
}

/**
 * Curva de acumulacao intra-mes: que fracao do gasto do mes ja ocorreu ate o
 * dia D. Sem isso a projecao assume gasto uniforme e, no dia 5, chuta 1/6 do
 * mes — subestimando quem concentra compra no comeco.
 */
function dayCurve(txns, exclude, currentMonth) {
  const ex = new Set(exclude)
  const perDay = new Array(32).fill(0)
  for (const t of txns) {
    if (t.igrp != null || t.kind === 'payment' || ex.has(t.mkey)) continue
    if (t.date.slice(0, 7) >= currentMonth) continue
    const d = Number(t.date.slice(8, 10))
    // soma crua: estorno ABATE o dia. O clamp vem depois, sobre o total do dia —
    // clampar por transacao faria o estorno sumir em vez de reduzir o gasto.
    if (d >= 1 && d <= 31) perDay[d] += outflow(t.kind, t.cents)
  }
  for (let d = 1; d <= 31; d++) perDay[d] = Math.max(0, perDay[d])
  const total = perDay.reduce((a, b) => a + b, 0)
  const cum = new Array(32).fill(0)
  if (total <= 0) {
    for (let d = 1; d <= 31; d++) cum[d] = d / 31
    return cum
  }
  let acc = 0
  for (let d = 1; d <= 31; d++) { acc += perDay[d]; cum[d] = acc / total }
  return cum
}

// ---------------------------------------------------------------- visao do mes

/** `ds` = { ledger, config, manual, statements } */
export function monthView(ds, todayISO) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements)
  // a fatura mais recente pode ter vindo do app, nao do backfill
  const last = [ledger?.last_statement, ...statements.map((s) => s.ref)]
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const month = todayISO.slice(0, 7)
  const day = Number(todayISO.slice(8, 10))
  const dim = daysInMonth(Number(todayISO.slice(0, 4)), Number(todayISO.slice(5, 7)))

  const installments = installmentsDue(txns, last, month)
  const installments_cents = installments.reduce((a, i) => a + i.cents, 0)

  const detected = detectSubscriptions(txns, last)
  const subscriptions_cents = detected.reduce((a, s) => a + s.cents, 0)
  // sem isso a assinatura conta duas vezes: travada aqui e diluida na projecao
  const exclude = detected.map((s) => s.key)

  const fixed = declaredRecurring(config, 'outflow')
  const fixed_outflow_cents = fixed.reduce((a, s) => a + s.cents, 0)
  const income_cents = declaredRecurring(config, 'inflow').reduce((a, s) => a + s.cents, 0)
  const subscriptions = [...detected, ...fixed]

  const hist = discretionaryHistory(txns, exclude, month)
  const sorted = [...hist].sort((a, b) => a - b)
  const baseline_cents = Math.round(pct(sorted, 0.5))

  const curve = dayCurve(txns, exclude, month)
  const elapsed_share = Math.min(1, Math.max(0, curve[Math.min(day, 31)]))
  const left = Math.max(0, 1 - elapsed_share)

  const loggedTxns = txns.filter((t) => t.source === 'manual' && t.date.slice(0, 7) === month)
  const logged_cents = loggedTxns.reduce((a, t) => a + outflow(t.kind, t.cents), 0)

  const band = (p) => Math.round(pct(sorted, p) * left)
  const remaining = { p10: band(0.10), p50: band(0.50), p90: band(0.90) }

  const locked = installments_cents + subscriptions_cents + fixed_outflow_cents
  const total = {
    p10: locked + logged_cents + remaining.p10,
    p50: locked + logged_cents + remaining.p50,
    p90: locked + logged_cents + remaining.p90,
  }
  // p90 de GASTO e o pior caso de SOBRA: os extremos invertem
  const net = {
    p10: income_cents - total.p90,
    p50: income_cents - total.p50,
    p90: income_cents - total.p10,
  }

  return {
    month, day, days_in_month: dim, elapsed_share,
    installments, subscriptions, installments_cents, subscriptions_cents,
    logged_cents, logged_count: loggedTxns.length, logged: loggedTxns,
    remaining, total, income_cents, fixed_outflow_cents, net,
    baseline_cents, last_statement: last,
    candidates: detectCandidates(txns, last, config),
  }
}

// ---------------------------------------------------------------- fluxo de caixa

export function cashflow(ds, fromMonth, horizon = 12, openingCents = 0) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements)
  const last = [ledger?.last_statement, ...statements.map((s) => s.ref)]
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const detected = detectSubscriptions(txns, last)
  const exclude = detected.map((s) => s.key)
  const subs = detected.reduce((a, s) => a + s.cents, 0)
  const fixed = declaredRecurring(config, 'outflow').reduce((a, s) => a + s.cents, 0)
  const income = declaredRecurring(config, 'inflow').reduce((a, s) => a + s.cents, 0)

  const sorted = [...discretionaryHistory(txns, exclude, fromMonth)].sort((a, b) => a - b)
  const d = {
    p10: Math.round(pct(sorted, 0.10)),
    p50: Math.round(pct(sorted, 0.50)),
    p90: Math.round(pct(sorted, 0.90)),
  }

  const out = []
  let b10 = openingCents, b50 = openingCents, b90 = openingCents
  for (let k = 0; k < horizon; k++) {
    const m = monthAdd(fromMonth, k)
    const inst = installmentsDue(txns, last, m).reduce((a, i) => a + i.cents, 0)
    const rec = subs + fixed
    const net = {
      p10: income - (inst + rec + d.p90),
      p50: income - (inst + rec + d.p50),
      p90: income - (inst + rec + d.p10),
    }
    // a banda do SALDO abre com o tempo: empilha meses ruins em sequencia
    b10 += net.p10; b50 += net.p50; b90 += net.p90
    out.push({
      month: m, installments_cents: inst, recurring_cents: rec,
      discretionary: d, income_cents: income, net,
      balance: { p10: b10, p50: b50, p90: b90 },
    })
  }
  return out
}
