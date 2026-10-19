/**
 * Leitura do PASSADO e alavancas pro FUTURO.
 *
 * O engine.js responde "quanto a fatura vai dar". Este modulo responde as duas
 * perguntas que ele nao respondia:
 *
 *   historyView  "pra onde foi o dinheiro?"  — fatura a fatura, por bloco
 *                (parcelas / recorrentes / variavel), por categoria e por lojista.
 *   leversView   "o que eu faco pra fatura cair?" — uma lista RANQUEADA por
 *                R$/mes do que esta ao alcance: assinatura que da pra cancelar,
 *                parcela que acaba sozinha, categoria acima do seu normal,
 *                lojista que subiu, compra unica que inflou a ultima fatura.
 *
 * Tudo puro: recebe o dataset, devolve objetos. Nenhum numero novo e inventado
 * aqui — bloco, parcela e recorrente usam as MESMAS regras do engine (senao o
 * historico diria uma coisa e a projecao outra, pro mesmo mes).
 */
import {
  hydrate, outflow, monthAdd, pct, cicloDaFatura, isoAddDays,
  installmentsDue, detectSubscriptions, declaredRecurring, cancelledKeys,
  LOOKBACK_MONTHS,
} from './engine'

/**
 * Fatura FECHADA cujo extrato para muito antes do fim do ciclo.
 *
 * Aconteceu: out/26 foi importada em 08/09, ainda aberta, com lancamentos ate
 * 06/09 — e nunca reimportada depois que fechou em 30/09. Ficou com 56 linhas e
 * R$ 7,9k onde um mes normal tem ~170 e R$ 11-17k. Qualquer "media das ultimas
 * 3" que a inclua mente pra baixo, e o app diria que voce economizou.
 *
 * Folga de 7 dias: compra dos ultimos dias do ciclo posta na fatura SEGUINTE
 * (ver `dias_atrasados` no engine), entao a ultima data de uma fatura completa
 * fica uns 2-3 dias antes do fechamento.
 */
const FOLGA_INCOMPLETA_DIAS = 7
const FRACAO_LINHAS_INCOMPLETA = 0.6
/**
 * Dois sinais, os DOIS obrigatorios: extrato que para cedo E poucas linhas.
 * So a data pegava jan/26 (ultima compra em 23/12, semana de Natal — 152
 * linhas, mes inteiro). So a contagem pegaria um mes de ferias de verdade.
 */
function faturaIncompleta(datas, ciclo, todayISO, n, nTipico) {
  if (ciclo.fim >= todayISO) return false // ainda aberta: incompleta por definicao, nao e erro
  if (!datas.length) return true
  const ultima = datas.reduce((a, b) => (b > a ? b : a))
  const paraCedo = ultima < isoAddDays(ciclo.fim, -FOLGA_INCOMPLETA_DIAS)
  const poucasLinhas = nTipico > 0 && n < nTipico * FRACAO_LINHAS_INCOMPLETA
  return paraCedo && poucasLinhas
}

/** Mediana de linhas por fatura fechada — a regua do "poucas linhas". */
function linhasTipicas(txns, meses) {
  const ns = meses.map((m) => txns.filter((t) => t.cash === m).length).filter((n) => n > 0)
  return medianaDe(ns)
}

export const SEM_CATEGORIA = 'Sem categoria'

/** Fatura que esta sendo preenchida hoje: compra deste mes cai na do mes seguinte. */
export function faturaAlvo(todayISO) {
  return monthAdd(todayISO.slice(0, 7), 1)
}

function lastStatementOf(ds) {
  const { ledger, statements = [] } = ds
  return [ledger?.last_statement, ...statements.map((s) => s.ref)].filter(Boolean).sort().pop() ?? null
}

function mediaDe(vals) {
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
}

function medianaDe(vals) {
  return Math.round(pct([...vals].sort((a, b) => a - b), 0.5))
}

/**
 * Chaves de lojista que contam como RECORRENTE no historico.
 *
 * Declarado ativo + detectado + cancelado. O cancelado entra de proposito: no
 * passado ele ERA recorrente, e o historico descreve o passado. (Na projecao
 * o engine o tira — la a pergunta e outra.) "Nao e recorrente" (dispensado)
 * fica fora: a decisao foi justamente que aquilo e gasto do dia a dia.
 */
function recurringSets(txns, last, config) {
  const canceladas = new Set(cancelledKeys(config))
  const declared = declaredRecurring(config, 'outflow')
  const declaredKeys = new Set(declared.map((r) => r.key).filter(Boolean))
  const detected = detectSubscriptions(txns, last).filter((s) => !declaredKeys.has(s.key))
  const keys = new Set([
    ...declaredKeys,
    ...canceladas,
    ...detected.map((s) => s.key),
  ])
  return { keys, declared, detected, canceladas }
}

function blocoDe(t, keys) {
  if (t.igrp != null) return 'parcelas'
  if (keys.has(t.mkey)) return 'recorrentes'
  return 'variavel'
}

// ---------------------------------------------------------------- historico

/**
 * Ultimas `n` faturas, abertas por bloco, categoria e lojista.
 *
 * Agrupa por CASH month (mes da fatura) — e a unica janela completa por
 * construcao; o mes-calendario e cortado pelo fechamento do cartao. Pagamento
 * de fatura fica de fora (nao e gasto), estorno entra negativo.
 */
export function historyView(ds, todayISO, n = 13) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements, config)
  const last = lastStatementOf(ds)
  const alvo = faturaAlvo(todayISO)
  const { keys } = recurringSets(txns, last, config)

  const todos = [...new Set(txns.map((t) => t.cash).filter(Boolean))].sort()
  const janela = todos.filter((m) => m <= alvo).slice(-n)
  const importadaEm = new Map(statements.map((s) => [s.ref, (s.generated ?? '').slice(0, 10) || null]))
  const nTipico = linhasTipicas(txns, todos.filter((m) => m < alvo))

  const meses = janela.map((m) => {
    const tt = txns.filter((t) => t.cash === m && t.kind !== 'payment')
    const ciclo = cicloDaFatura(m)
    const datas = tt.map((t) => t.date).filter(Boolean)
    const blocos = { parcelas: 0, recorrentes: 0, variavel: 0 }
    const porCat = new Map()
    const porLoj = new Map()
    let total = 0
    for (const t of tt) {
      const v = outflow(t.kind, t.cents)
      const bloco = blocoDe(t, keys)
      total += v
      blocos[bloco] += v

      const cat = t.cat || SEM_CATEGORIA
      const c = porCat.get(cat) ?? { cat, cents: 0, n: 0, parcelas: 0, recorrentes: 0, variavel: 0 }
      c.cents += v; c.n++; c[bloco] += v
      porCat.set(cat, c)

      const k = t.mkey || t.desc
      const l = porLoj.get(k) ?? { key: k, label: t.desc, cat, cents: 0, n: 0, bloco, txns: [] }
      l.cents += v; l.n++
      if (t.date > (l.ultimo ?? '')) { l.ultimo = t.date; l.label = t.desc }
      l.txns.push({
        date: t.date, desc: t.desc, cents: v, kind: t.kind, cat, bloco,
        parcela: t.ino != null && t.itot != null ? `${t.ino}/${t.itot}` : null,
        event: !!t.event, source: t.source,
      })
      porLoj.set(k, l)
    }
    const categorias = [...porCat.values()].sort((a, b) => b.cents - a.cents)
    const lojistas = [...porLoj.values()]
      .map((l) => ({ ...l, txns: l.txns.sort((a, b) => b.date.localeCompare(a.date)) }))
      .sort((a, b) => b.cents - a.cents)
    return {
      month: m,
      aberta: m >= alvo || ciclo.fim >= todayISO,
      incompleta: faturaIncompleta(datas, ciclo, todayISO, tt.length, nTipico),
      importada_em: importadaEm.get(m) ?? null,
      ultima_data: datas.length ? datas.reduce((a, b) => (b > a ? b : a)) : null,
      total, ...blocos, n: tt.length,
      categorias, lojistas,
      ciclo_inicio: ciclo.inicio, ciclo_fim: ciclo.fim,
    }
  })

  return {
    meses, last_statement: last, fatura_alvo: alvo,
    incompletas: meses.filter((m) => m.incompleta),
  }
}

/**
 * Media por categoria das `k` faturas FECHADAS imediatamente anteriores a `month`.
 * Devolve Map cat -> cents/mes. Mes sem a categoria conta como zero — a media e
 * "quanto essa categoria custa num mes tipico", nao "quando aparece".
 */
export function baselinePorCategoria(meses, month, k = 6) {
  const antes = meses.filter((x) => x.month < month && !x.aberta && !x.incompleta).slice(-k)
  const acc = new Map()
  for (const mm of antes) for (const c of mm.categorias) acc.set(c.cat, (acc.get(c.cat) ?? 0) + c.cents)
  const out = new Map()
  for (const [c, v] of acc) out.set(c, Math.round(v / Math.max(1, antes.length)))
  return { base: out, meses: antes.length }
}

/** Historico mensal de UM lojista dentro da janela: [{month, cents, n}]. */
export function lojistaHistorico(meses, key) {
  return meses.map((m) => {
    const l = m.lojistas.find((x) => x.key === key)
    return { month: m.month, aberta: m.aberta, cents: l?.cents ?? 0, n: l?.n ?? 0, txns: l?.txns ?? [] }
  })
}

// ---------------------------------------------------------------- alavancas

const MIN_FREQ_MESES = 4        // "quase todo mes": 4 das 6 ultimas faturas
const MIN_FREQ_CENTS = 10000    // abaixo de R$ 100/mes nao e alavanca
const MIN_LOJ_SUBIU_CENTS = 10000
const MIN_EVENTO_CENTS = 50000  // compra unica >= R$ 500 na ultima fatura

/**
 * Alavancas ranqueadas por R$/mes.
 *
 * So entra o que e ACIONAVEL ou INEVITAVEL-E-BOM:
 *   assinaturas     da pra cancelar hoje. Valor = o que a fatura cobra.
 *   frequentes      aparecem quase todo mes com valor que varia (credito de
 *                   API, farmacia, Uber). Nao sao assinatura, mas somam mais
 *                   que muitas — e sao onde um habito muda a fatura.
 *   parcelas        acabam sozinhas; aqui esta QUANDO e QUANTO volta pro bolso.
 *   categorias      variavel das ultimas 3 faturas contra a mediana de 12.
 *   lojistas        quem subiu nas ultimas 3 contra as 9 anteriores.
 *   eventos         compras unicas que inflaram a ULTIMA fatura fechada.
 *
 * Nada aqui decide por voce: e a lista do que move o ponteiro, com o tamanho.
 */
export function leversView(ds, todayISO) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements, config)
  const last = lastStatementOf(ds)
  const alvo = faturaAlvo(todayISO)
  const { keys, declared, detected, canceladas } = recurringSets(txns, last, config)

  const todos = [...new Set(txns.map((t) => t.cash).filter(Boolean))].sort()
  // fechada = ciclo ja terminou. A fatura alvo esta aberta por definicao.
  // Incompleta (importada aberta e nunca reimportada) sai das medias: ela nao
  // descreve um mes, descreve metade de um.
  const nTipico = linhasTipicas(txns, todos.filter((m) => m < alvo))
  const incompletas = todos.filter((m) => m < alvo).filter((m) => {
    const tt = txns.filter((t) => t.cash === m && t.kind !== 'payment')
    return faturaIncompleta(tt.map((t) => t.date).filter(Boolean), cicloDaFatura(m), todayISO, tt.length, nTipico)
  })
  const fechadas = todos.filter((m) => m < alvo && cicloDaFatura(m).fim < todayISO && !incompletas.includes(m))
  const ult3 = fechadas.slice(-3)
  const ult12 = fechadas.slice(-12)
  const ult6 = fechadas.slice(-LOOKBACK_MONTHS)
  const ultima = fechadas[fechadas.length - 1] ?? null

  const gasto = (t) => t.kind !== 'payment'
  const totalMes = (m) => txns.filter((t) => t.cash === m && gasto(t)).reduce((a, t) => a + outflow(t.kind, t.cents), 0)
  const nivel3 = mediaDe(ult3.map(totalMes))
  const nivel12 = medianaDe(ult12.map(totalMes))

  // ---- 1. assinaturas (recorrente no cartao, nao cancelado)
  const ultimoVisto = (key) => txns.filter((t) => t.mkey === key).map((t) => t.cash).sort().pop() ?? null
  const declCartao = declared.filter((r) => r.key && !canceladas.has(r.key))
  const assinaturas = [
    ...declCartao.map((r) => ({
      key: r.key, label: r.label, cents: r.cents, category: r.category ?? null,
      declared: true, reembolsado: !!r.reembolsado, ultimo: ultimoVisto(r.key),
    })),
    ...detected.filter((s) => !canceladas.has(s.key)).map((s) => ({
      key: s.key, label: s.label, cents: s.cents, category: s.category ?? null,
      declared: false, reembolsado: false, ultimo: ultimoVisto(s.key), months_seen: s.months_seen,
    })),
  ].sort((a, b) => b.cents - a.cents)
  const foraDoCartao = declared.filter((r) => !r.key).map((r) => ({
    id: r.id, label: r.label, cents: r.cents, category: r.category ?? null,
  })).sort((a, b) => b.cents - a.cents)
  const assinaturas_cents = assinaturas.filter((a) => !a.reembolsado).reduce((a, s) => a + s.cents, 0)
  const fora_cents = foraDoCartao.reduce((a, s) => a + s.cents, 0)

  // ---- 2. frequentes: quase todo mes, valor variavel, nao e assinatura nem parcela
  const porLoj = new Map()
  for (const t of txns) {
    if (t.kind !== 'purchase' || t.igrp != null || !t.mkey || keys.has(t.mkey)) continue
    if (!ult6.includes(t.cash)) continue
    const g = porLoj.get(t.mkey) ?? { key: t.mkey, label: t.desc, category: t.cat ?? null, porMes: new Map() }
    g.porMes.set(t.cash, (g.porMes.get(t.cash) ?? 0) + t.cents)
    if (t.cat && !g.category) g.category = t.cat
    if (t.date > (g.ultimo ?? '')) { g.ultimo = t.date; g.label = t.desc }
    porLoj.set(t.mkey, g)
  }
  const frequentes = [...porLoj.values()]
    .filter((g) => g.porMes.size >= MIN_FREQ_MESES)
    .map((g) => {
      const vals = ult6.map((m) => g.porMes.get(m) ?? 0)
      const media6 = mediaDe(vals)
      const media3 = mediaDe(ult3.map((m) => g.porMes.get(m) ?? 0))
      return {
        key: g.key, label: g.label, category: g.category, meses: g.porMes.size, de: ult6.length,
        cents: media6, media3, min: Math.min(...vals.filter((v) => v > 0)), max: Math.max(...vals),
      }
    })
    .filter((g) => g.cents >= MIN_FREQ_CENTS)
    .sort((a, b) => b.cents - a.cents)
  const frequentes_cents = frequentes.reduce((a, g) => a + g.cents, 0)

  // ---- 3. parcelas: o que esta na fatura alvo e quando cada contrato acaba
  const contratos = installmentsDue(txns, last, alvo).map((i) => ({
    ...i,
    // `remaining` e contado a partir da ULTIMA fatura importada; a parcela
    // `number` e a da fatura alvo. Acaba quando number == total.
    restam: i.total - i.number,
    termina: monthAdd(alvo, i.total - i.number),
  })).sort((a, b) => a.termina.localeCompare(b.termina) || b.cents - a.cents)
  const parcelas_alvo = contratos.reduce((a, i) => a + i.cents, 0)
  const runoff = []
  for (let k = 0; k < 13; k++) {
    const m = monthAdd(alvo, k)
    const due = installmentsDue(txns, last, m)
    const cents = due.reduce((a, i) => a + i.cents, 0)
    const anterior = runoff[k - 1]?.cents ?? cents
    const acabam = contratos.filter((c) => c.termina === monthAdd(m, -1)).map((c) => c.label)
    runoff.push({ month: m, cents, count: due.length, alivio: Math.max(0, anterior - cents), acabam })
  }

  // ---- 4. categorias: variavel ult3 vs mediana 12 (zeros preenchidos)
  const catMes = new Map() // cat -> Map(month -> cents)
  for (const t of txns) {
    if (!gasto(t) || !ult12.includes(t.cash)) continue
    if (blocoDe(t, keys) !== 'variavel') continue
    const c = t.cat || SEM_CATEGORIA
    if (!catMes.has(c)) catMes.set(c, new Map())
    const mm = catMes.get(c)
    mm.set(t.cash, (mm.get(t.cash) ?? 0) + outflow(t.kind, t.cents))
  }
  const metaCat = config?.budget?.categories ?? {}
  const categorias = [...catMes.entries()].map(([cat, mm]) => {
    const serie12 = ult12.map((m) => mm.get(m) ?? 0)
    const serie3 = ult3.map((m) => mm.get(m) ?? 0)
    const media3 = mediaDe(serie3)
    const med12 = medianaDe(serie12)
    const meta = metaCat[cat] ?? null
    return {
      cat, media3, med12, delta: media3 - med12, meta,
      vs_meta: meta != null ? media3 - meta : null,
      ultima: mm.get(ultima) ?? 0,
    }
  }).sort((a, b) => b.delta - a.delta)

  // ---- 5. lojistas em alta: ult3 vs 9 anteriores (variavel)
  const ant9 = ult12.slice(0, Math.max(0, ult12.length - 3))
  const lojMes = new Map()
  for (const t of txns) {
    if (t.kind !== 'purchase' || !t.mkey || !ult12.includes(t.cash)) continue
    if (blocoDe(t, keys) !== 'variavel') continue
    const g = lojMes.get(t.mkey) ?? { key: t.mkey, label: t.desc, category: t.cat ?? null, porMes: new Map() }
    g.porMes.set(t.cash, (g.porMes.get(t.cash) ?? 0) + t.cents)
    if (t.cat && !g.category) g.category = t.cat
    if (t.date > (g.ultimo ?? '')) { g.ultimo = t.date; g.label = t.desc }
    lojMes.set(t.mkey, g)
  }
  const lojistas_alta = [...lojMes.values()].map((g) => {
    const media3 = mediaDe(ult3.map((m) => g.porMes.get(m) ?? 0))
    const mediaAnt = ant9.length ? mediaDe(ant9.map((m) => g.porMes.get(m) ?? 0)) : 0
    return { key: g.key, label: g.label, category: g.category, media3, antes: mediaAnt, delta: media3 - mediaAnt,
      meses3: ult3.filter((m) => g.porMes.has(m)).length }
  })
    .filter((g) => g.delta >= MIN_LOJ_SUBIU_CENTS && g.meses3 >= 2)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10)

  // ---- 6. eventos da ultima fatura fechada: compra unica grande ou marcada
  const eventos = ultima
    ? txns
      .filter((t) => t.cash === ultima && t.kind === 'purchase' && t.igrp == null && !keys.has(t.mkey))
      .filter((t) => t.event || t.cents >= MIN_EVENTO_CENTS)
      .map((t) => ({ date: t.date, desc: t.desc, cents: t.cents, cat: t.cat ?? null, event: !!t.event }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 10)
    : []
  const eventos_cents = eventos.reduce((a, e) => a + e.cents, 0)

  // ---- resumo contra a meta
  const meta = config?.budget?.total_cents || null
  const ultima_cents = ultima ? totalMes(ultima) : 0

  return {
    fatura_alvo: alvo, ultima, ultima_cents, nivel3, nivel12, meses_fechadas: fechadas.length,
    incompletas,
    meta, gap: meta ? nivel3 - meta : null,
    assinaturas, assinaturas_cents, foraDoCartao, fora_cents,
    frequentes, frequentes_cents,
    contratos, parcelas_alvo, runoff,
    categorias, lojistas_alta,
    eventos, eventos_cents,
    ult3, ult12,
  }
}
