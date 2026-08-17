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
/** Faturas fechadas que definem o NIVEL do gasto variavel projetado. Curto de
 *  proposito: mudanca de habito precisa aparecer no mes seguinte, nao daqui a
 *  um ano. A banda de incerteza continua vindo da janela de 12 meses. */
export const NIVEL_MESES = 2
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
/**
 * Identidade de UM lancamento, pra marca-lo como evento.
 *
 * Deliberadamente nao e o merchant_key: o mesmo lojista pode ter uma compra
 * rotineira e outra dez vezes maior — marcar o lojista jogaria fora o gasto normal junto. E
 * deliberadamente nao e o indice da linha: reimportar a fatura reordena tudo.
 * Data + lojista + valor sobrevive a reimport e distingue os dois casos.
 */
export function eventKey(t) {
  return `${t.date}|${t.mkey}|${t.cents}`
}

export function hydrate(ledger, manual = [], statements = [], config = null) {
  /*
   * A memoria e aplicada na LEITURA, nao gravada dentro de cada fatura.
   *
   * Assim, classificar "Ze Delivery" uma vez conserta todos os meses em que ele
   * aparece — inclusive os ja importados — sem reescrever arquivo nenhum. Se a
   * categoria fosse gravada na fatura, corrigir um erro exigiria reimportar
   * tudo.
   */
  const mem = config?.memory ?? {}
  /*
   * Evento marcado a mao, aplicado na LEITURA pelo mesmo motivo da memoria:
   * reimportar a fatura nao pode apagar a decisao. `1` = e evento, `0` = ja
   * perguntei e nao e (pra parar de sugerir).
   */
  const eventos = config?.events ?? {}
  const comMemoria = (t) => {
    const mkey = semMes(t.mkey)
    const base = mkey === t.mkey ? t : { ...t, mkey }
    const ev = eventos[eventKey(base)] ?? eventos[eventKey(t)]
    const comEv = ev === 1 ? { ...base, event: true } : base
    if (comEv.cat || !mkey) return comEv
    const m = mem[mkey] ?? mem[t.mkey]
    return m ? { ...comEv, cat: m[0] ?? null, sub: m[1] ?? null } : comEv
  }
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
  })).map(comMemoria)

  // faturas importadas pelo app: ja vem no formato de objeto
  for (const st of statements) {
    for (const t of st.txns ?? []) out.push(comMemoria({ ...t, source: 'import' }))
  }

  for (const m of manual) {
    out.push(comMemoria({
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
    }))
  }
  return out
}

// SO abreviacoes de 3 letras. Nome por extenso fica de fora porque "MARCO" e
// "MAIO" sao nomes de gente: com eles na lista, "MARCO POLO BAR" virava
// "POLO BAR" e dois lojistas diferentes se fundiam.
const MES_TOKEN = /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)$/

/**
 * Tira o mes de dentro do nome do lojista.
 *
 * O Itau escreve "Medycorp Ass*jun Pac 2", "Medycorp Ass*jul Pac 2"... — mesmo
 * contrato, um lojista diferente por mes. Assim ele nunca junta 5 meses e nunca
 * e detectado como recorrente, embora seja R$ 488 fixos todo mes.
 *
 * Aplicado SOBRE a chave ja normalizada (nao recalculado da descricao) pra nao
 * introduzir divergencia com o merchant_key do Python que gerou o baseline.
 * Exige sobrar 2+ tokens: "JUL" sozinho continua sendo um lojista chamado JUL.
 */
export function semMes(key) {
  if (!key) return key
  const toks = String(key).split(' ')
  // 4+ tokens: "MEDYCORP ASS JUN PAC 2" entra, "BAR DO MAR" e "MARCO POLO BAR"
  // ficam de fora. Lojista com nome curto quase nunca carrega mes no meio.
  if (toks.length < 4) return key
  const limpo = toks.filter((t) => !MES_TOKEN.test(t))
  return limpo.length >= 3 && limpo.length < toks.length ? limpo.join(' ') : key
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
    if (!g) { g = { key: t.mkey, porMes: new Map(), label: t.desc, cat: t.cat }; by.set(t.mkey, g) }
    /*
     * Agrega por MES antes de estatistica.
     *
     * Antes a mediana era das TRANSACOES: transporte publico, cobrado ~15x por
     * mes, entrava no bloco travado pelo valor de UMA passagem em vez do custo
     * mensal. A pergunta que o bloco responde e "quanto este lojista me custa
     * por mes", nao "quanto custa cada compra".
     */
    g.porMes.set(t.cash, (g.porMes.get(t.cash) ?? 0) + t.cents)
    if (t.cat && !g.cat) g.cat = t.cat
  }

  const out = []
  for (const g of by.values()) {
    const meses = [...g.porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    if (meses.length < minMonths) continue
    const vals = meses.map(([, v]) => v)

    /*
     * cv na janela cheia confunde MUDANCA DE PRECO com instabilidade.
     *
     * Uma assinatura que dobra de preco no meio da janela fica com cv ~0,30 e
     * cai no variavel — mas ha tres meses ela e um valor cravado, ou seja,
     * perfeitamente previsivel. O cv alto descrevia o passado, nao o futuro.
     *
     * Testa-se entao da janela mais longa pra mais curta e fica-se com a
     * primeira estavel. O piso de `minMonths` continua valendo, entao ninguem
     * vira recorrente por dois meses soltos: precisa aparecer em 5 dos 6 E ter
     * valor estavel nos ultimos 3 (ou 2).
     */
    let usados = vals
    let mudou_preco = false
    /*
     * A janela curta tem piso de 3 meses. Com 2, uma recarga de credito de API
     * — que variou 7x em seis meses — travava como "assinatura" so porque dois
     * meses seguidos calharam de ficar proximos. Com 3, o cv dela volta a
     * estourar e ela fica no variavel, que e onde consumo variavel pertence;
     * assinaturas que mudaram de preco de verdade continuam sendo capturadas.
     */
    if (cvOf(vals) > MAX_CV && vals.length > 3 && cvOf(vals.slice(-3)) <= MAX_CV) {
      usados = vals.slice(-3); mudou_preco = true
    }
    const sorted = [...usados].sort((a, b) => a - b)
    out.push({
      key: g.key, label: g.label, category: g.cat ?? null,
      months: meses.length, median: Math.round(pct(sorted, 0.5)), cv: cvOf(usados),
      cv_janela: cvOf(vals), mudou_preco, meses_usados: usados.length,
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
function discretionaryHistory(txns, exclude, currentMonth, months = 12, modo = 'sem-evento') {
  const ex = new Set(exclude)
  const by = new Map()
  for (const t of txns) {
    if (t.igrp != null || t.kind === 'payment' || ex.has(t.mkey)) continue
    const m = t.cash ?? t.date.slice(0, 7)
    if (m >= currentMonth) continue // mes em curso e parcial
    /*
     * O mes precisa existir na grade mesmo quando nao tem nada da categoria
     * pedida. Sem isso a provisao de evento dividia o total por 3 (os meses em
     * que houve evento) em vez de 12 — e uma viagem por ano virava provisao de
     * viagem a cada quatro meses.
     */
    if (!by.has(m)) by.set(m, 0)
    if (modo === 'sem-evento' && t.event) continue
    if (modo === 'so-evento' && !t.event) continue
    by.set(m, by.get(m) + outflow(t.kind, t.cents))
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-months).map(([, v]) => v)
}

/**
 * NIVEL do gasto variavel — a base UNICA das duas abas.
 *
 * Existe como funcao propria porque ja divergiu na pratica: o mes corrente
 * projetava o resto do ciclo pela mediana de 12 meses enquanto o fluxo de caixa
 * projetava os meses seguintes pelas 2 ultimas faturas. Resultado absurdo — o
 * mes seguinte saia MAIOR que o atual mesmo com quase mil reais a menos de
 * parcela, porque a janela longa ainda carregava um mes de pico ja superado.
 *
 * Nivel: media das ultimas `NIVEL_MESES` faturas, sem evento.
 * Banda:  razao p10/p50 e p90/p50 dos 12 meses, aplicada sobre o nivel.
 * Evento: media de 12 meses, devolvida a parte como provisao.
 */
export function variableLevel(txns, exclude, currentMonth, emCurso = null) {
  const longo = [...discretionaryHistory(txns, exclude, currentMonth)].sort((a, b) => a - b)
  const p50_longo = Math.round(pct(longo, 0.5))
  const r10 = p50_longo > 0 ? pct(longo, 0.10) / p50_longo : 0.75
  const r90 = p50_longo > 0 ? pct(longo, 0.90) / p50_longo : 1.35

  const recente = discretionaryHistory(txns, exclude, currentMonth, NIVEL_MESES)
  let soma = recente.reduce((a, b) => a + b, 0)
  let peso = recente.length
  let curso = null

  /*
   * Abaixo de 1/4 do ciclo a anualizacao e chute: uma compra grande no dia 3
   * viraria "nivel" pro mes inteiro. O peso ainda cresce com os dias depois
   * disso, entao o numero se firma sozinho conforme o mes anda.
   */
  if (emCurso && emCurso.elapsed >= 0.25 && emCurso.cents > 0) {
    const anualizado = emCurso.cents / emCurso.elapsed
    soma += anualizado * emCurso.elapsed
    peso += emCurso.elapsed
    curso = { anualizado: Math.round(anualizado), peso: emCurso.elapsed }
  }

  const nivel = peso > 0 ? Math.round(soma / peso) : p50_longo

  const eventosHist = discretionaryHistory(txns, exclude, currentMonth, 12, 'so-evento')
  const provisao_eventos = eventosHist.length
    ? Math.round(eventosHist.reduce((a, b) => a + b, 0) / eventosHist.length)
    : 0

  return {
    nivel,
    d: { p10: Math.round(nivel * r10), p50: nivel, p90: Math.round(nivel * r90) },
    provisao_eventos,
    regime: {
      p50_longo, p50_curto: nivel, meses_curto: recente.length, meses_nivel: NIVEL_MESES,
      fechadas: recente.length
        ? Math.round(recente.reduce((a, b) => a + b, 0) / recente.length) : p50_longo,
      curso,
      divergencia: p50_longo > 0 ? (nivel - p50_longo) / p50_longo : 0,
      provisao_eventos, meses_evento: eventosHist.filter((x) => x > 0).length,
      total_eventos: eventosHist.reduce((a, b) => a + b, 0),
    },
  }
}

const MIN_EVENTO_CENTS = 30000     // abaixo de R$ 300 nao vale a pergunta
const MULT_EVENTO = 3              // 3x a mediana do proprio lojista
const SOZINHO_CENTS = 70000        // lojista sem historico: R$ 700 e o corte

/**
 * Sugere quais lancamentos sao EVENTO, nao rotina.
 *
 * Duas reguas, porque os dois casos existem:
 *   - lojista conhecido com valor fora de escala: a loja de conveniencia que
 *     custa dezenas de reais num dia normal aparece uma vez com valor de festa.
 *     Corte absoluto nao pega, porque o mesmo valor num supermercado e rotina.
 *   - lojista que aparece uma vez so e caro (passagem aerea, loja de viagem).
 *     Nao ha mediana pra comparar; ai o corte e absoluto.
 *
 * Sugere, nao decide. O mesmo valor e evento ou rotina dependendo do contexto —
 * o dado nao distingue, voce distingue.
 */
export function detectEventCandidates(txns, config, exclude = []) {
  const ex = new Set(exclude)
  const decidido = config?.events ?? {}
  const porLojista = new Map()
  for (const t of txns) {
    if (t.kind !== 'purchase' || t.igrp != null || !t.mkey || ex.has(t.mkey)) continue
    if (!porLojista.has(t.mkey)) porLojista.set(t.mkey, [])
    porLojista.get(t.mkey).push(t.cents)
  }

  const out = []
  /*
   * Uma linha por CHAVE, nao por transacao.
   *
   * Fatura importada duas vezes sob refs diferentes (aconteceu: um CSV de marco
   * que era copia da fatura de abril) repete a mesma compra no ledger. Como a
   * chave de evento e data+lojista+valor, as copias tem a MESMA chave: marcar
   * uma marcava todas, mas a lista mostrava a mesma compra N vezes, empurrando
   * os outros candidatos pra fora do limite de 10.
   */
  const jaListado = new Set()
  for (const t of txns) {
    if (t.kind !== 'purchase' || t.igrp != null || !t.mkey || ex.has(t.mkey)) continue
    if (t.cents < MIN_EVENTO_CENTS) continue
    const k = eventKey(t)
    if (decidido[k] !== undefined) continue          // ja respondido, sim ou nao
    if (jaListado.has(k)) continue
    jaListado.add(k)

    const vals = porLojista.get(t.mkey) ?? []
    let motivo = null
    if (vals.length >= 3) {
      const med = pct([...vals].sort((a, b) => a - b), 0.5)
      if (med > 0 && t.cents >= med * MULT_EVENTO) {
        motivo = `${(t.cents / med).toFixed(1)}× a mediana do lojista (R$ ${Math.round(med / 100)})`
      }
    } else if (t.cents >= SOZINHO_CENTS) {
      motivo = vals.length <= 1 ? 'compra única e alta' : 'lojista raro, valor alto'
    }
    if (motivo) {
      out.push({ key: k, date: t.date, desc: t.desc, mkey: t.mkey, cents: t.cents, cat: t.cat, motivo })
    }
  }
  return out.sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date))
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

// ---------------------------------------------------------------- 4. meta

const DIAS_CICLO = 30

/**
 * Meta do mes -> quanto ainda da pra gastar, e por dia.
 *
 * A conta e deliberadamente de SUBTRACAO, nao de projecao: parte do teto e tira
 * o que ja esta comprometido. Projecao entra so como referencia ("no ritmo de
 * hoje voce fecha em X"), nunca como o numero que manda.
 *
 *   teto_fatura  = meta do mes - fixos que nao passam no cartao
 *   comprometido = o que ja esta na fatura + recorrente que ainda vai postar
 *   disponivel   = teto - comprometido        <- isto e o que sobra pro dia a dia
 *   por_dia      = disponivel / dias que faltam do ciclo
 *
 * Por que por_dia e o numero de capa: "gastei 68% da meta" nao diz o que fazer
 * hoje. "R$ 115 por dia ate o fechamento" diz.
 *
 * IMPORTANTE, e a razao de nao existir projecao por categoria aqui: com ~9
 * lancamentos de Alimentacao em 14 dias e 63% do valor concentrado em 3 deles,
 * extrapolar a categoria multiplica ruido. Medido no historico, a mesma conta
 * variava ~30% pra mesma categoria dependendo da curva usada, enquanto o
 * VARIAVEL AGREGADO ficou estavel entre meses (~3%). Entao: agrega-se pra projetar,
 * detalha-se por categoria so pra medir consumo contra a meta.
 */
function goalView({ config, elapsed_share, fixed_outflow_cents, ja_na_fatura_cents,
                    a_entrar_cents, variavelTxns, restante_variavel_cents,
                    travado_cents, todayISO }) {
  const meta = config?.budget
  if (!meta?.total_cents) return null

  const teto_fatura_cents = meta.total_cents - fixed_outflow_cents

  /*
   * Evento sai do RITMO mas fica no gasto.
   *
   * Um jantar caro num dia 11 nao significa que voce gasta aquilo por dia — mas
   * o dinheiro saiu e reduz o que sobra. Entao ele entra em `ja_na_fatura`
   * (logo, no disponivel) e fica de fora da divisao que produz o R$/dia.
   */
  const eventos_cents = variavelTxns.filter((t) => t.event)
    .reduce((a, t) => a + outflow(t.kind, t.cents), 0)
  const rotinaTxns = variavelTxns.filter((t) => !t.event)
  const variavel_cents = rotinaTxns.reduce((a, t) => a + outflow(t.kind, t.cents), 0)

  /*
   * O extrato ATRASA. O Itau exporta a fatura aberta com lancamentos ate uns 3-5
   * dias atras; o que voce gastou ontem ainda nao esta la. Isso cria dois vieses
   * em direcoes opostas, e os dois precisam de denominadores diferentes:
   *
   *   ritmo  -> divide pelos dias COM DADO. Dividir pelos dias corridos joga
   *             gasto de 14 dias sobre 18 e subestima o ritmo em ~22%.
   *   sobra  -> desconta o que provavelmente ja foi gasto e ainda nao postou.
   *             Sem isso o app anuncia folga que nao existe, todo dia.
   */
  const datas = rotinaTxns.map((t) => t.date).filter(Boolean).sort()
  const inicio = datas[0]
  const ultimo = datas[datas.length - 1]
  const dias = (a, b) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000)

  const dias_corridos = Math.min(DIAS_CICLO, Math.max(1, Math.round(elapsed_share * DIAS_CICLO)))
  const dias_com_dado = inicio && ultimo ? Math.max(1, dias(inicio, ultimo) + 1) : dias_corridos
  const dias_sem_dado = Math.max(0, dias_corridos - dias_com_dado)
  // +1: hoje ainda conta como dia de gasto — e evita divisao por zero no ultimo dia
  const dias_restantes = Math.max(1, DIAS_CICLO - dias_corridos + 1)

  const ritmo_cents = Math.round(variavel_cents / dias_com_dado)
  const nao_postado_cents = ritmo_cents * dias_sem_dado
  const disponivel_cents = teto_fatura_cents - ja_na_fatura_cents - a_entrar_cents - nao_postado_cents
  const comprometido_cents = ja_na_fatura_cents + a_entrar_cents + nao_postado_cents
  const por_dia_cents = Math.round(disponivel_cents / dias_restantes)

  // se mantiver o ritmo atual ate o fim: projeta o buraco do atraso + o futuro
  const no_ritmo_cents = ja_na_fatura_cents + a_entrar_cents + fixed_outflow_cents
    + ritmo_cents * (DIAS_CICLO - dias_com_dado)

  const porCat = new Map()
  // peso do rateio = so a ROTINA. Evento nao se repete, entao nao deve puxar
  // pra si uma fatia do que ainda falta — mesma regra do card "ainda entra".
  let baseRateio = 0
  for (const t of variavelTxns) {
    const c = t.cat || 'Sem categoria'
    const g = porCat.get(c) ?? { cents: 0, n: 0, rotina: 0 }
    const v = outflow(t.kind, t.cents)
    g.cents += v; g.n++
    if (!t.event) { g.rotina += v; baseRateio += v }
    porCat.set(c, g)
  }
  const metasCat = meta.categories ?? {}
  const categorias = [...new Set([...porCat.keys(), ...Object.keys(metasCat)])]
    .map((cat) => {
      const g = porCat.get(cat) ?? { cents: 0, n: 0 }
      const consumido_cents = g.cents
      const meta_cents = metasCat[cat] ?? null
      const share = meta_cents ? consumido_cents / meta_cents : null
      /*
       * Projetado = consumido + a fatia da categoria no que AINDA falta.
       *
       * Nao e `consumido / fracao decorrida`. Dividir pela fracao projeta cada
       * categoria isolada, e isso e ruidoso (poucos lancamentos numa quinzena)
       * — mas o pior e que dava um numero DIFERENTE do card "ainda deve
       * entrar", que rateia o total agregado. O mesmo gasto com dois valores em
       * dois cards da mesma tela, e o usuario sem saber em qual acreditar.
       *
       * Agora os dois partem do mesmo agregado (o unico numero confiavel) e da
       * mesma distribuicao observada. `confiavel` continua marcando as
       * categorias com poucos lancamentos, onde a DIVISAO e fraca mesmo que o
       * total esteja certo.
       */
      const peso = baseRateio > 0 ? g.rotina / baseRateio : 0
      const projetado_cents = consumido_cents + Math.round(restante_variavel_cents * peso)
      return {
        cat,
        meta_cents,
        consumido_cents,
        n: g.n,
        projetado_cents,
        confiavel: g.n >= 8,
        // positivo = vai estourar a meta da categoria
        distancia_cents: meta_cents == null ? null : projetado_cents - meta_cents,
        restante_cents: meta_cents == null ? null : meta_cents - consumido_cents,
        share,
        /*
         * O sinal nao e "passou de 100%", e "passou na frente do calendario":
         * 60% da meta consumida com 46% do ciclo decorrido ja e alerta, mesmo
         * longe do teto. Comparar contra elapsed_share e o que torna a regua
         * util no meio do mes em vez de so no fim.
         */
        adiantado: share == null ? null : share - elapsed_share,
        por_dia_cents: meta_cents == null
          ? null
          : Math.round((meta_cents - consumido_cents) / dias_restantes),
      }
    })
    .sort((a, b) => b.consumido_cents - a.consumido_cents)

  return {
    meta_total_cents: meta.total_cents,
    teto_fatura_cents, comprometido_cents, disponivel_cents,
    dias_ciclo: DIAS_CICLO, dias_corridos, dias_restantes, dias_com_dado, dias_sem_dado,
    nao_postado_cents, eventos_cents,
    variavel_cents, ritmo_cents, por_dia_cents, no_ritmo_cents,
    distancia_cents: no_ritmo_cents - meta.total_cents,
    categorias,
    sem_meta_cents: categorias
      .filter((c) => c.meta_cents == null)
      .reduce((a, c) => a + c.consumido_cents, 0),
    /*
     * De onde vem a distancia ate a meta, em tres pedacos que somam.
     *
     * O travado (parcela + recorrente + fixo fora) e o piso: ele consome a meta
     * antes de voce decidir qualquer coisa. O que sobra e o teto do variavel —
     * e so contra ESSE numero faz sentido comparar as metas por categoria.
     */
    /*
     * `travado` vem PRONTO de fora, nao derivado por subtracao.
     *
     * Derivar de `comprometido - variavel - eventos` dava um terceiro numero:
     * omitia os fixos que nao passam no cartao (que a meta inclui) e embutia a
     * estimativa de nao-postado, que e variavel. A tela mostrava R$ 5.141 no
     * KPI e R$ 3.784 nesta linha, para a mesma palavra.
     */
    decomposicao: {
      travado_cents,
      teto_variavel_cents: meta.total_cents - travado_cents,
      variavel_projetado_cents: variavel_cents + ritmo_cents * (DIAS_CICLO - dias_com_dado),
      eventos_cents,
    },
  }
}

// ---------------------------------------------------------------- visao do mes

/** `ds` = { ledger, config, manual, statements } */
export function monthView(ds, todayISO) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements, config)
  // a fatura mais recente pode ter vindo do app, nao do backfill
  const last = [ledger?.last_statement, ...statements.map((s) => s.ref)]
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const month = todayISO.slice(0, 7)
  const day = Number(todayISO.slice(8, 10))
  const dim = daysInMonth(Number(todayISO.slice(0, 4)), Number(todayISO.slice(5, 7)))

  /*
   * A fatura que voce esta enchendo AGORA nao e a do mes corrente.
   *
   * Ciclo do cartao: compra de julho -> fatura "Agosto" (vence 05/08). Entao em
   * 14/08 a fatura de agosto ja fechou E ja venceu; o que voce gasta hoje cai na
   * de SETEMBRO. Usar o mes-calendario aqui mostrava as parcelas de uma fatura
   * ja paga — dinheiro que ja saiu, apresentado como compromisso futuro.
   *
   * Derivar de `month + 1` e nao de `last_statement + 1` de proposito: o alvo
   * depende de que dia e hoje, nao de qual fatura voce lembrou de importar.
   */
  const fatura_alvo = monthAdd(month, 1)
  const installments = installmentsDue(txns, last, fatura_alvo)
  const installments_cents = installments.reduce((a, i) => a + i.cents, 0)

  /*
   * Declarado GANHA de detectado, e o detectado sai da lista.
   *
   * Confirmar no card "isso e recorrente?" um lojista que o detector JA pegava
   * sozinho fazia ele entrar duas vezes — uma pelo valor calculado, outra pelo
   * confirmado — e o travado somava a mesma assinatura em dobro. Quem manda e a
   * decisao explicita: se voce cadastrou, e o seu valor que vale.
   */
  const declaredKeys = new Set(
    declaredRecurring(config, 'outflow').map((r) => r.key).filter(Boolean)
  )
  const detected = detectSubscriptions(txns, last).filter((s) => !declaredKeys.has(s.key))
  const subscriptions_cents = detected.reduce((a, s) => a + s.cents, 0)
  // sem isso a assinatura conta duas vezes: travada aqui e diluida na projecao
  const exclude = detected.map((s) => s.key)

  /*
   * Recorrente confirmado na mao se divide em dois, e o sinal que separa e ter
   * `key` (merchant_key): quem foi confirmado a partir de um lojista do CARTAO
   * carrega a chave dele; quem foi cadastrado a mao (Marina, seguro, surf) nao
   * tem. Sem essa divisao, CLAUDE.AI (que passa no cartao) ficava do lado de
   * fora e a fatura estimada saia R$ 582 menor do que sera.
   */
  const fixed = declaredRecurring(config, 'outflow')
  const fixedNoCartao = fixed.filter((s) => s.key)
  const fixedForaDoCartao = fixed.filter((s) => !s.key)
  const fixed_card_cents = fixedNoCartao.reduce((a, s) => a + s.cents, 0)
  const fixed_outflow_cents = fixedForaDoCartao.reduce((a, s) => a + s.cents, 0)
  const income_cents = declaredRecurring(config, 'inflow').reduce((a, s) => a + s.cents, 0)
  const subscriptions = [...detected, ...fixed]

  /*
   * Tudo que ja e contado num bloco travado sai do variavel: detectados E
   * confirmados na mao. Sem os confirmados, CLAUDE.AI & cia entram no travado E
   * na distribuicao do variavel — contados duas vezes.
   */
  const exSet = new Set([...exclude, ...fixedNoCartao.map((r) => r.key).filter(Boolean)])
  const excludeTudo = [...exSet]

  /*
   * MESMA base do fluxo de caixa. Antes daqui saia a mediana de 12 meses e de
   * la o nivel de 2 — o mesmo gasto variavel com dois valores, e o mes seguinte
   * aparecendo maior que o atual sem nenhuma razao economica.
   */

  /*
   * Se a fatura em formacao ja foi importada (o Itau exporta a fatura ABERTA),
   * o gasto ate agora nao precisa ser estimado: esta ali, linha a linha. E uma
   * base muito melhor que projecao — e melhor ainda que lancamento manual, que
   * depende de disciplina.
   */
  const naFaturaAberta = txns.filter((t) => t.cash === fatura_alvo && t.source === 'import')
  const temFaturaAberta = naFaturaAberta.length > 0

  // gasto VARIAVEL do ciclo: nem parcela, nem recorrente. E a unica parte que
  // responde ao que voce faz hoje — e por isso a unica que a meta diaria governa.
  const variavelNaFatura = naFaturaAberta.filter((t) => t.igrp == null && !exSet.has(t.mkey))
  const realizado_cents = variavelNaFatura.reduce((a, t) => a + outflow(t.kind, t.cents), 0)

  const loggedTxns = txns.filter((t) => t.source === 'manual' && t.date.slice(0, 7) === month)
  const manual_cents = loggedTxns.reduce((a, t) => a + outflow(t.kind, t.cents), 0)
  const logged_cents = realizado_cents + manual_cents

  /*
   * Quanto do ciclo ja passou.
   *
   * Com fatura aberta, mede-se pelo proprio ciclo dela (primeira compra -> +1
   * mes), nao pelo dia do mes-calendario: o ciclo do cartao vai do dia 30 ao 29,
   * entao "dia 14 do mes" e ~50% do ciclo, nao 45% dele.
   */
  let elapsed_share = null
  if (temFaturaAberta) {
    // SEM parcelado: a linha parcelada carrega a data ORIGINAL da compra, entao
    // usar o minimo de todas dava "ciclo comecou em out/2025" e 100% decorrido.
    const datas = naFaturaAberta.filter((t) => t.igrp == null).map((t) => t.date).sort()
    const inicio = datas[0]
    if (inicio) {
      const dias = Math.round(
        (Date.parse(`${todayISO}T00:00:00`) - Date.parse(`${inicio}T00:00:00`)) / 86400000
      )
      // fora de 0-45 dias o ciclo nao faz sentido; cai no metodo antigo
      if (dias >= 0 && dias <= 45) elapsed_share = Math.min(1, dias / 30)
    }
  }
  if (elapsed_share === null) {
    const curve = dayCurve(txns, excludeTudo, month)
    elapsed_share = Math.min(1, Math.max(0, curve[Math.min(day, 31)]))
  }
  const left = Math.max(0, 1 - elapsed_share)

  /*
   * O ciclo em curso entra no NIVEL, com peso proporcional ao que ja se viu.
   *
   * Antes o nivel vinha so das 2 faturas fechadas, e a economia comecada agora
   * so apareceria na projecao dois meses depois — o painel mostrava o
   * comportamento antigo enquanto o novo ja estava acontecendo. Agora o mes
   * parcial e anualizado (gasto / fracao decorrida) e entra como uma observacao
   * de peso `elapsed`: com 60% do ciclo visto, vale 0,6 mes contra 1,0 de cada
   * fatura fechada. Peso proporcional a informacao, nao a vontade de acreditar.
   */
  const emCurso = { cents: realizado_cents + manual_cents, elapsed: elapsed_share }
  const nivelInfo = variableLevel(txns, excludeTudo, fatura_alvo, emCurso)
  const baseline_cents = nivelInfo.nivel

  // o que falta do ciclo = nivel x fatia restante. Provisao de evento NAO entra:
  // no mes corrente o evento ou ja aconteceu (esta no realizado) ou nao vai
  // acontecer — projetar "meia festa" no meio do mes nao ajuda ninguem.
  const remaining = {
    p10: Math.round(nivelInfo.d.p10 * left),
    p50: Math.round(nivelInfo.d.p50 * left),
    p90: Math.round(nivelInfo.d.p90 * left),
  }

  /*
   * Duas totalizacoes diferentes, e misturar as duas engana:
   *
   *   fatura = o que vai chegar do CARTAO (parcelas + assinaturas + variavel)
   *   total  = custo do mes = fatura + fixos que NAO passam no cartao
   *            (Marina, seguro do carro, surf)
   *
   * Somar os fixos de fora dentro de algo chamado "fatura estimada" inchava o
   * numero em R$ 1.590 e fazia a fatura parecer maior do que sera.
   */
  /*
   * A fatura se monta em TRES pedacos, e so o ultimo e chute:
   *
   *   ja_na_fatura   fato. Com a fatura aberta importada, e o proprio numero do
   *                  Itau — da pra conferir na tela do banco.
   *   a_entrar       recorrente que ainda nao postou neste ciclo. Quase certo.
   *   remaining      variavel do resto do ciclo. Este sim e previsao.
   *
   * Antes eu somava parcelas + assinaturas + realizado + projecao, o que
   * contava assinatura JA postada pelo valor mediano em vez do valor real e
   * nao batia com o extrato. Ancorar no numero do banco torna a conta
   * conferivel.
   */
  const recorrentesCartao = [...detected, ...fixedNoCartao]
  let ja_na_fatura_cents
  let a_entrar_cents
  let a_entrar_itens = []
  if (temFaturaAberta) {
    ja_na_fatura_cents = naFaturaAberta.reduce((a, t) => a + outflow(t.kind, t.cents), 0) + manual_cents
    const jaPostou = new Set(naFaturaAberta.map((t) => t.mkey))
    a_entrar_itens = recorrentesCartao.filter((s) => s.key && !jaPostou.has(s.key))
    a_entrar_cents = a_entrar_itens.reduce((a, s) => a + s.cents, 0)
  } else {
    // sem fatura aberta, tudo e projecao: parcelas + recorrentes + o que voce lancou
    ja_na_fatura_cents = installments_cents + manual_cents
    a_entrar_itens = recorrentesCartao
    a_entrar_cents = subscriptions_cents + fixed_card_cents
  }

  const fatura = {
    p10: ja_na_fatura_cents + a_entrar_cents + remaining.p10,
    p50: ja_na_fatura_cents + a_entrar_cents + remaining.p50,
    p90: ja_na_fatura_cents + a_entrar_cents + remaining.p90,
  }
  const total = {
    p10: fatura.p10 + fixed_outflow_cents,
    p50: fatura.p50 + fixed_outflow_cents,
    p90: fatura.p90 + fixed_outflow_cents,
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
    realizado_cents, manual_cents, tem_fatura_aberta: temFaturaAberta,
    remaining, fatura, total, income_cents, fixed_outflow_cents, fixed_card_cents, net,
    ja_na_fatura_cents, a_entrar_cents,
    baseline_cents, last_statement: last, fatura_alvo, em_curso: emCurso,
    nivel_regime: nivelInfo.regime, a_entrar_itens,

    /*
     * O QUE AINDA VAI ENTRAR, aberto por categoria.
     *
     * O KPI somava tudo sem dizer de onde vinha, e as duas metades tem
     * naturezas opostas — misturar as duas num numero so esconde justamente o
     * que da pra agir:
     *
     *   fixo     recorrente que ainda nao postou neste ciclo. E NOMEAVEL: da pra
     *            listar item a item e a data e quase certa. Nao ha o que decidir.
     *   variavel o resto do ciclo. Este e o unico pedaco que responde ao que
     *            voce fizer amanha.
     *
     * O rateio do variavel por categoria e proporcional ao que ja se gastou no
     * proprio ciclo — nao e projecao por categoria (que ja provou ser ruido com
     * poucos lancamentos), e sim a distribuicao observada aplicada ao total
     * agregado, que e o unico numero em que confio.
     */
    falta_por_categoria: (() => {
      const porCat = new Map()
      const add = (cat, campo, cents) => {
        const c = cat || 'Sem categoria'
        const g = porCat.get(c) ?? { cat: c, fixo_cents: 0, variavel_cents: 0 }
        g[campo] += cents
        porCat.set(c, g)
      }
      for (const s of a_entrar_itens) add(s.category, 'fixo_cents', s.cents)

      const gastoCat = new Map()
      let base = 0
      for (const t of [...variavelNaFatura, ...loggedTxns]) {
        if (t.event) continue // evento nao se repete: nao serve de peso pro resto
        const c = t.cat || 'Sem categoria'
        const v = outflow(t.kind, t.cents)
        gastoCat.set(c, (gastoCat.get(c) ?? 0) + v)
        base += v
      }
      if (base > 0) {
        for (const [c, v] of gastoCat) add(c, 'variavel_cents', Math.round(remaining.p50 * (v / base)))
      } else if (remaining.p50 > 0) {
        add('Sem categoria', 'variavel_cents', remaining.p50)
      }
      return [...porCat.values()]
        .map((g) => ({ ...g, total_cents: g.fixo_cents + g.variavel_cents }))
        .filter((g) => g.total_cents !== 0)
        .sort((a, b) => b.total_cents - a.total_cents)
    })(),
    goal: goalView({
      config, elapsed_share, fixed_outflow_cents, ja_na_fatura_cents, a_entrar_cents,
      variavelTxns: [...variavelNaFatura, ...loggedTxns], todayISO,
      // a MESMA fatia que o card "ainda deve entrar" rateia, pra os dois cards
      // da mesma tela nao darem numeros diferentes pro mesmo gasto
      restante_variavel_cents: remaining.p50,
      // a MESMA definicao do KPI "ja travado": parcelas + recorrentes do cartao
      // + fixos de fora. Sem passar pronto, a decomposicao inventava um terceiro
      // valor pra mesma palavra.
      travado_cents: installments_cents + subscriptions_cents + fixed_card_cents
        + fixed_outflow_cents,
    }),
    candidates: detectCandidates(txns, last, config),
    /*
     * Janela de 12 meses, a MESMA que alimenta a provisao no fluxo de caixa.
     * Com 6, uma viagem do inicio da janela nunca aparecia pra ser marcada — mas
     * continuava dentro da janela da provisao, inflando o nivel sem correcao.
     */
    eventCandidates: detectEventCandidates(
      txns.filter((t) => t.cash >= monthAdd(month, -11)), config, excludeTudo
    ).slice(0, 10),
    /*
     * Recorrente confirmado que NAO aparece mais nas ultimas faturas.
     *
     * Acontece quando o lojista muda de nome no extrato: "CLAUDE.AI
     * SUBSCRIPTION" virou "Anthropic* Claude Sub" na exportacao nova. O antigo
     * vira custo fantasma travado e o novo entra no variavel — o mesmo gasto
     * contado duas vezes, e por isso o mes parece maior do que e.
     */
    /*
     * Lancamento manual que a fatura ja trouxe.
     *
     * O `reconcile` do import so casa quando o LOJISTA e parecido — e no
     * lancamento manual o nome quase nunca bate: voce digita o app de entrega
     * e o extrato traz o restaurante. Resultado: centenas de reais contados
     * duas vezes, e invisiveis.
     *
     * Aqui a regra e outra de proposito: valor EXATO + ate 3 dias, sem exigir
     * lojista. Dois gastos de valor identico no mesmo dia sao quase certamente
     * o mesmo. Mas "quase" nao apaga nada sozinho — a lista aparece pra voce
     * decidir, que e a mesma politica do resto do app.
     */
    duplicados: (() => {
      if (!temFaturaAberta) return []
      const usados = new Set()
      const out = []
      for (const m of loggedTxns) {
        const i = naFaturaAberta.findIndex((t, idx) => {
          if (usados.has(idx) || t.kind !== 'purchase' || t.cents !== m.cents) return false
          const dd = Math.abs(Math.round(
            (Date.parse(`${t.date}T00:00:00`) - Date.parse(`${m.date}T00:00:00`)) / 86400000))
          return dd <= 3
        })
        if (i >= 0) { usados.add(i); out.push({ manual: m, fatura: naFaturaAberta[i] }) }
      }
      return out
    })(),

    /*
     * Recorrente confirmado que sumiu — E o provavel substituto.
     *
     * Quase sempre o lojista so trocou de nome no extrato (a empresa mudou a
     * razao social). A despesa nao acabou; a CHAVE mudou. Mas o conserto era de
     * dois passos — remover aqui, confirmar o novo no card de candidatos — e
     * parar no primeiro passo apaga uma assinatura que continua sendo cobrada. Entao o substituto e procurado aqui: mesmo valor (+-15%) na
     * janela recente, ainda nao declarado. Com ele, a migracao vira um clique.
     */
    sumidos: (() => {
      if (!last) return []
      const janela = new Set([last, monthAdd(last, -1), monthAdd(last, -2)])
      const recentes = txns.filter((t) => janela.has(t.cash) && t.kind === 'purchase' && t.igrp == null)
      const vistos = new Set(recentes.map((t) => t.mkey))
      const declarados = new Map(fixed.filter((r) => r.key).map((r) => [r.key, r]))

      const porChave = new Map()
      for (const t of recentes) {
        const g = porChave.get(t.mkey)
          ?? { key: t.mkey, label: t.desc, cat: t.cat, vals: [], meses: new Set() }
        g.vals.push(t.cents); g.meses.add(t.cash)
        if (t.cat && !g.cat) g.cat = t.cat
        porChave.set(t.mkey, g)
      }

      return fixedNoCartao.filter((s) => s.key && !vistos.has(s.key)).map((s) => {
        let sucessor = null
        for (const g of porChave.values()) {
          const med = pct([...g.vals].sort((a, b) => a - b), 0.5)
          if (!med) continue
          /*
           * Tres filtros, cada um por um falso positivo que aconteceu.
           *
           * 5% e nao 15%: com a banda larga, um Pix avulso de R$ 500 foi
           * apontado como "sucessor" de uma assinatura de R$ 585. A mesma
           * assinatura sob outro nome nao anda 15% — anda centavos.
           *
           * 2 dos 3 meses: aparecer uma vez so nao e recorrencia, e coincidencia
           * de valor.
           *
           * Mesma categoria: transferencia nao sucede assinatura. So compara
           * quando as duas categorias sao conhecidas, pra nao perder o caso em
           * que o lojista novo ainda nao foi classificado.
           */
          if (Math.abs(med - s.cents) / s.cents > 0.05) continue
          if (g.meses.size < 2) continue
          if (s.category && g.cat && s.category !== g.cat) continue
          if (sucessor && g.meses.size <= sucessor.meses) continue
          sucessor = {
            key: g.key, label: g.label, cents: Math.round(med), meses: g.meses.size,
            /*
             * Se o sucessor JA esta cadastrado, migrar nao e o conserto — os
             * dois estao ativos e a despesa conta em dobro dentro do proprio
             * bloco travado. Ai o que resta e apagar este aqui.
             */
            ja_declarado: declarados.has(g.key),
          }
        }
        return { ...s, sucessor }
      })
    })(),
  }
}

// ---------------------------------------------------------------- fluxo de caixa

export function cashflow(ds, fromMonth, horizon = 12, openingCents = 0, todayISO = null) {
  const { ledger, config, manual = [], statements = [] } = ds ?? {}
  const txns = hydrate(ledger, manual, statements, config)
  const last = [ledger?.last_statement, ...statements.map((s) => s.ref)]
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const fixedAll = declaredRecurring(config, 'outflow')
  // mesma deduplicacao do monthView: declarado ganha, detectado sai da lista
  const declaredKeys = new Set(fixedAll.map((r) => r.key).filter(Boolean))
  const detected = detectSubscriptions(txns, last).filter((s) => !declaredKeys.has(s.key))

  /*
   * Mesma exclusao do monthView, e pela mesma razao.
   *
   * Contava-se aqui so os DETECTADOS. O recorrente confirmado na mao que passa
   * no cartao entrava em `fixed` E continuava dentro da mediana do variavel —
   * a mesma assinatura cobrada duas vezes, todo mes do horizonte.
   */
  const exclude = [...new Set([
    ...detected.map((s) => s.key),
    ...fixedAll.map((r) => r.key).filter(Boolean),
  ])]
  const subs = detected.reduce((a, s) => a + s.cents, 0)
  const fixed = fixedAll.reduce((a, s) => a + s.cents, 0)
  const income = declaredRecurring(config, 'inflow').reduce((a, s) => a + s.cents, 0)

  /*
   * NIVEL vem das ultimas 2 faturas; DISPERSAO vem dos 12 meses.
   *
   * A mediana de 12 meses demora um ANO pra enxergar mudanca de padrao. Caso
   * tipico: uma assinatura cara sai do cartao e o gasto cai de uma vez — a
   * mediana longa so refletiria isso um ano depois, projetando ate la um custo
   * que nao existe mais.
   *
   * Mas 2 meses nao dao banda: com duas observacoes, p10 e p90 sao os proprios
   * dois numeros, e a faixa vira ruido. Entao separa-se o que cada janela sabe
   * fazer — a curta diz ONDE esta o nivel, a longa diz QUANTO ele costuma
   * variar — e a razao p10/p50 e p90/p50 da longa e aplicada sobre o nivel novo.
   */
  /*
   * monthView PRIMEIRO, porque o nivel depende do ciclo em curso.
   *
   * As duas abas tem que sair da MESMA base: quando o mes corrente projetava
   * pela mediana longa e o fluxo pelas 2 ultimas faturas, novembro aparecia
   * maior que setembro sem nenhuma razao economica.
   */
  let mv = null
  if (todayISO) {
    try { mv = monthView(ds, todayISO) } catch { mv = null }
  }
  const { d, provisao_eventos, regime } = variableLevel(txns, exclude, fromMonth, mv?.em_curso)

  /*
   * Evento vira PROVISAO, nao desaparece.
   *
   * Uma viagem ou uma festa sao gasto real — sumir com elas faria a projecao
   * mentir pra baixo. Mas elas tambem nao acontecem todo mes: dentro do nivel,
   * uma festa de quatro digitos vira previsao de festa mensal.
   *
   * Entao saem do nivel (que responde "quanto custa um mes normal") e voltam
   * como media dos ultimos 12 meses (que responde "quanto custam os anormais,
   * diluido"). A soma das duas e o gasto esperado; a separacao e o que deixa a
   * meta diaria fazer sentido.
   */

  /*
   * O primeiro mes nao e uma previsao — e quase um fato.
   *
   * Ele e a fatura que esta em formacao AGORA: metade dela ja esta lancada e as
   * parcelas estao todas conhecidas. Projeta-lo pela mediana de 12 meses, como
   * se nada se soubesse, dava quase 20% a mais do que o mes corrente mostra na
   * outra aba — o mesmo mes com dois numeros diferentes, e o usuario sem saber
   * em qual acreditar. Aqui o mes 1 passa a herdar o numero do
   * monthView; os seguintes seguem estatisticos.
   */
  const out = []
  let b10 = openingCents, b50 = openingCents, b90 = openingCents
  for (let k = 0; k < horizon; k++) {
    const m = monthAdd(fromMonth, k)
    const inst = installmentsDue(txns, last, m).reduce((a, i) => a + i.cents, 0)
    const rec = subs + fixed
    const ancorado = k === 0 && mv && mv.fatura_alvo === m

    // com ancora, o gasto do mes e o total do monthView; sem, e a soma dos
    // blocos + a provisao de evento (que no mes ancorado ja esta no realizado)
    const gasto = ancorado
      ? { p10: mv.total.p10, p50: mv.total.p50, p90: mv.total.p90 }
      : {
          p10: inst + rec + d.p10 + provisao_eventos,
          p50: inst + rec + d.p50 + provisao_eventos,
          p90: inst + rec + d.p90 + provisao_eventos,
        }

    const net = {
      p10: income - gasto.p90,
      p50: income - gasto.p50,
      p90: income - gasto.p10,
    }
    // a banda do SALDO abre com o tempo: empilha meses ruins em sequencia
    b10 += net.p10; b50 += net.p50; b90 += net.p90
    out.push({
      month: m, installments_cents: inst, recurring_cents: rec,
      // no mes ancorado o "variavel" e o residuo, pra linha continuar somando
      discretionary: ancorado
        ? { p10: gasto.p10 - inst - rec, p50: gasto.p50 - inst - rec, p90: gasto.p90 - inst - rec }
        : d,
      gasto, ancorado, income_cents: income, net, regime,
      balance: { p10: b10, p50: b50, p90: b90 },
    })
  }
  return out
}
