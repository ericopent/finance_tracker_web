/**
 * Importacao de fatura no navegador.
 *
 * Espelha scripts/backfill.py: mesma deteccao de `kind`, mesma chave de
 * contrato parcelado, mesma normalizacao de lojista. Se os dois divergirem, o
 * historico antigo e o novo param de casar e a projecao mente.
 *
 * Faturas importadas pelo app viram `data/statements/YYYY-MM.json`, arquivos
 * separados — nao sao appendadas no ledger.json. Isso evita reescrever 334KB a
 * cada import e, principalmente, evita que rodar o export_web.py de novo (a
 * partir do SQLite, que fica desatualizado) apague o que foi importado no
 * celular.
 */
import { merchantKey } from './engine.js'

// ---------------------------------------------------------------- CSV

/** Parser de CSV com aspas, BOM e delimitador detectado (`,` ou `;`). Devolve a grade crua. */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!clean.trim()) return []

  const first = clean.slice(0, clean.indexOf('\n') + 1 || undefined)
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','

  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * Acha onde a tabela comeca de verdade.
 *
 * O CSV do banco tem cabecalho na linha 1, mas o XLSX do Itau tem 13 linhas de
 * preambulo (nome, agencia, conta, total da fatura) antes de "Data |
 * Lancamento | Parcelamento | Valor". Assumir linha 1 quebrava o import de
 * Excel inteiro.
 */
export function locateTable(grid) {
  const limite = Math.min(grid.length, 40)
  for (let i = 0; i < limite; i++) {
    const cells = grid[i].map(norm)
    const temDesc = cells.some((c) => /lancamento|descricao|historico|estabelecimento/.test(c))
    const temValor = cells.some((c) => /^valor$|amount|quantia/.test(c))
    if (temDesc && temValor) {
      return {
        header: grid[i].map((h) => String(h ?? '').trim()),
        rows: grid.slice(i + 1).filter((r) => r.some((c) => String(c ?? '').trim())),
        headerRow: i + 1,
      }
    }
  }
  // sem cabecalho reconhecivel: trata a linha 1 como cabecalho (comportamento antigo)
  const [h = [], ...r] = grid
  return {
    header: h.map((x) => String(x ?? '').trim()),
    rows: r.filter((x) => x.some((c) => String(c ?? '').trim())),
    headerRow: 1,
  }
}

const norm = (s) =>
  String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Descobre quais colunas sao data / descricao / valor / parcelamento. */
export function detectColumns(header) {
  const h = header.map(norm)
  const find = (cands) => h.findIndex((x) => x && cands.some((c) => x === c || x.includes(c)))
  return {
    date: find(['data', 'date', 'dt']),
    desc: find(['lancamento', 'descricao', 'description', 'historico', 'estabelecimento', 'title']),
    value: find(['valor', 'amount', 'value', 'quantia']),
    // o XLSX do Itau tem coluna propria de parcelamento; no CSV vem colado no nome
    parc: find(['parcelamento', 'parcela']),
  }
}

const MESES_PT = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

// ---------------------------------------------------------------- valores e datas

/** Aceita "1.234,56", "1234.56", "-45,90", "(45,90)", "R$ 1,234.56", "-BRL 10,746.10". */
export function parseValue(raw) {
  let s = String(raw ?? '').trim()
    // o sinal pode vir ANTES da moeda ("-BRL 10,746.10") ou depois
    .replace(/^([-+])?\s*(R\$|BRL|US\$|USD)\s*/i, '$1')
    .replace(/\s/g, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  if (s.startsWith('+')) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s)) return null

  const hasC = s.includes(','), hasD = s.includes('.')
  if (hasC && hasD) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (hasC) s = s.replace(/\./g, '').replace(',', '.')
  else if (hasD) {
    // Ponto sozinho e ambiguo. A regra que funciona: separador de milhar vem
    // SEMPRE em grupo de exatamente 3 digitos. Entao "1.234" e milhar, mas
    // "9.9" e "45.90" sao decimais.
    // (Exigir 2 digitos, como eu fazia, lia 9.9 como 99 e triplicava a fatura.)
    const p = s.split('.')
    const milhar = p.length > 2 || p[p.length - 1].length === 3
    if (milhar) s = s.replace(/\./g, '')
  }
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  return Math.round(v * 100) * (neg ? -1 : 1)
}

/** ISO, dd/mm/yyyy e dd/mm/yy (janela 2000-2099). */
export function parseDate(raw) {
  const s = String(raw ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  }
  return null
}

/**
 * Mes de referencia a partir do nome do arquivo ou da aba.
 *
 *   fatura-20260605.csv                        -> 2026-06
 *   Fatura 07-26              (aba do Itau)    -> 2026-07
 *   fatura-paga-final 9058-julho2026.xlsx      -> 2026-07
 *
 * O terceiro caso importa: o "9058" do numero do cartao era lido como ano.
 */
export function refMonthFromName(name) {
  const s = String(name ?? '')

  // "julho2026" / "julho de 2026"
  const pt = norm(s).match(
    /(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\D{0,4}(\d{4})/
  )
  if (pt) return `${pt[2]}-${String(MESES_PT[pt[1]]).padStart(2, '0')}`

  // "20260605"
  const compacto = s.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
  if (compacto) return `${compacto[1]}-${compacto[2]}`

  // "2026-06" / "2026_06"
  const iso = s.match(/(20\d{2})[-_](0[1-9]|1[0-2])\b/)
  if (iso) return `${iso[1]}-${iso[2]}`

  // "Fatura 07-26" -> mes-ano de 2 digitos
  const curto = s.match(/\b(0[1-9]|1[0-2])[-/](\d{2})\b/)
  if (curto) return `20${curto[2]}-${curto[1]}`

  return null
}

// ---------------------------------------------------------------- kind (espelha backfill.py)

const RE_PAYMENT = /PAGAMENTO\s+EFETUADO|PAGTO\s+FATURA/i
const RE_INTEREST = /JUROS|ENCARGO|MORA|MULTA\s+POR\s+ATRASO|ROTATIV/i
const RE_FEE = /\bIOF\b|ANUIDADE|TARIFA|CESTA\s*SERVICOS/i
const RE_REFUND = /ESTORNO|CHARGEBACK|CREDITO\s+PROG/i

export function classifyKind(desc, cents) {
  const d = String(desc ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (RE_PAYMENT.test(d)) return 'payment'
  if (cents < 0 || RE_REFUND.test(d)) return 'refund'
  if (RE_INTEREST.test(d)) return 'interest'
  if (RE_FEE.test(d)) return 'fee'
  return 'purchase'
}

// ---------------------------------------------------------------- categoria

/** memoria aprendida > regras > nada. Mesma ordem do backfill. */
export function classify(desc, config) {
  const key = merchantKey(desc)
  const mem = config?.memory?.[key]
  if (mem) return { cat: mem[0] ?? null, sub: mem[1] ?? null, via: 'memoria' }

  const plain = String(desc ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  for (const r of config?.rules ?? []) {
    let re
    try { re = new RegExp(r.pattern, 'i') } catch { continue }
    if (re.test(plain)) return { cat: r.category, sub: r.subcategory ?? null, via: 'regra' }
  }
  return { cat: null, sub: null, via: null }
}

// ---------------------------------------------------------------- montagem

// Sem \s antes: o extrato cola a parcela no nome ("PAYPAL *FK PARTNER08/12").
// Exigir espaco perdia 18 dos 29 contratos da fatura de junho.
const PARCELA = /(\d{2})\/(\d{2})\s*$/

/** Coluna Parcelamento do Itau: "Parcela 1 de 10" — e nao "01/10". */
const PARCELA_COL = /(?:parcela\s*)?(\d{1,2})\s*(?:de|\/)\s*(\d{1,2})/i

/**
 * Transforma linhas cruas na fatura estruturada.
 * `anchorFor` resolve a ancora do contrato parcelado: mes da fatura menos
 * (parcela atual - 1), igual ao backfill.
 */
export function buildStatement({ grid, refMonth, config, fileName, sheetName }) {
  const { header, rows, headerRow } = locateTable(grid ?? [])
  const col = detectColumns(header)
  if (col.desc < 0 || col.value < 0) {
    throw new Error(
      `Não achei as colunas necessárias.\nCabeçalho lido: ${header.filter(Boolean).join(' | ') || '(vazio)'}\n` +
      `Preciso de uma coluna de descrição (lançamento/descrição) e uma de valor.`
    )
  }
  const ref = refMonth || refMonthFromName(sheetName) || refMonthFromName(fileName)
  if (!ref) throw new Error('Não consegui deduzir o mês da fatura. Escolha no seletor.')

  const txns = []
  const problemas = []

  /*
   * Compra internacional ocupa TRES linhas na fatura do Itau:
   *
   *   29/07/2026 | dólar de conversão     | R$ 5.43     <- cotacao, nao e gasto
   *              | Openai                 | R$ 137.43   <- a cobranca de verdade
   *              | United States          | $ 25.31     <- valor em dolar
   *
   * Somar as tres inflava a fatura em R$ 93,08 (8 cotacoes + uma linha de pais
   * que vinha com valor em BRL). Regra: a cotacao carrega a DATA, a linha
   * seguinte e a cobranca, e o que vier depois sem data e metadado.
   */
  let aguardandoCobranca = false
  let dataDoGrupo = null

  rows.forEach((r, i) => {
    const desc = String(r[col.desc] ?? '').trim()

    // A fatura ABERTA vem em secoes (nacionais / internacionais / encargos), cada
    // uma com seu proprio cabecalho e sua linha de TOTAL. Sem filtrar, o
    // "total dos lancamentos nacionais R$ 4.467,83" entra como se fosse compra e
    // a fatura dobra. Linha de total tem valor e parece lancamento — nao da pra
    // pegar so pelo formato, tem que ser pelo texto.
    const d = norm(desc)
    if (!d) return
    if (/^total\b|^subtotal\b|^saldo\b/.test(d)) return          // somatorio de secao
    if (/^lancamento$|^descricao$|^data$/.test(d)) return        // cabecalho repetido
    if (/^lancamentos?\s|^encargos e servicos$/.test(d)) return  // titulo de secao
    if (/^iof - transacao internacional$/.test(d)) return        // rotulo, valor 0

    const cents = parseValue(r[col.value])
    // `dataPropria` = a linha traz data na coluna dela. Distinto de `date`, que
    // a cobranca internacional HERDA da cotacao. Confundir os dois encerrava o
    // grupo cedo demais e deixava "United Kingdom | BRL 49.90" entrar como gasto.
    const dataPropria = col.date >= 0 ? parseDate(r[col.date]) : null
    let date = dataPropria

    // --- grupo de compra internacional ---
    if (/^dolar de conversao$/.test(d)) {
      aguardandoCobranca = true
      dataDoGrupo = dataPropria     // a cotacao carrega a data do grupo
      return                        // a cotacao em si nao e gasto
    }
    if (!dataPropria && aguardandoCobranca) {
      date = dataDoGrupo            // a cobranca herda a data da cotacao
      aguardandoCobranca = false
    } else if (!dataPropria && dataDoGrupo) {
      return                        // "United States", "valor em dólar": metadado
    }
    if (dataPropria) dataDoGrupo = null  // so linha com data PROPRIA encerra o grupo

    if (!desc || cents === null) {
      // So reclama de linha que PARECE lancamento (tem data ou valor). O rodape
      // do Itau ("Importante saber" + texto juridico) nao e erro, e ruido de
      // layout — reportar isso so assusta sem informar nada.
      if (date || cents !== null) {
        problemas.push({ linha: i + 1, motivo: 'incompleta', raw: r.filter((c) => String(c).trim()).join(' | ').slice(0, 70) })
      }
      return
    }
    const quando = date ?? `${ref}-01`
    const kind = classifyKind(desc, cents)
    const { cat, sub, via } = kind === 'purchase' ? classify(desc, config) : { cat: null, sub: null, via: null }

    // parcela pode vir colada no nome (CSV) ou em coluna propria (XLSX do Itau)
    const p = desc.match(PARCELA)
      ?? (col.parc >= 0 ? String(r[col.parc] ?? '').match(PARCELA_COL) : null)
    let ino = null, itot = null, igrp = null
    if (p) {
      ino = Number(p[1]); itot = Number(p[2])
      const anchor = monthShift(ref, -(ino - 1))
      igrp = `${merchantKey(desc)}|${itot}|${anchor}|${Math.abs(cents)}`
    }

    txns.push({
      date: quando, desc, mkey: merchantKey(desc), cents: Math.abs(cents),
      kind, cat, sub, ino, itot, igrp, cash: ref, via,
    })
  })

  /*
   * Pagamento ANTECIPADO abate a fatura corrente.
   *
   * A fatura traz duas coisas com o mesmo nome "Pagamento Efetuado": a quitacao
   * da fatura ANTERIOR (cai no comeco do ciclo, pelo valor cheio dela) e um
   * eventual pagamento adiantado desta aqui. Quando os dois aparecem, a soma
   * das compras nao bate com o "Voce pagou" impresso — e a diferenca e
   * exatamente o adiantamento.
   *
   * Regra: o MAIOR pagamento e a quitacao da anterior; qualquer outro e
   * adiantamento e reduz esta fatura. Confere em todas as faturas testadas.
   */
  const pagos = txns.filter((t) => t.kind === 'payment').map((t) => t.cents).sort((a, b) => b - a)
  const adiantamentos_cents = pagos.slice(1).reduce((a, c) => a + c, 0)

  const meta = lerCabecalho(grid ?? [], headerRow)
  return { ref, txns, problemas, adiantamentos_cents, fileName: fileName ?? null, ...meta }
}

/**
 * Le o preambulo da fatura: se esta aberta ou fechada, e o total que o proprio
 * banco imprime.
 *
 * O total serve de conferencia automatica — se a soma dos lancamentos nao bate
 * com o que o Itau diz, o parser errou e e melhor avisar do que gravar torto.
 * Fatura ABERTA importa porque ela e parcial por natureza: o ciclo ainda esta
 * correndo e o valor so cresce.
 */
function lerCabecalho(grid, headerRow) {
  // so o preambulo: depois comeca a tabela, e uma compra grande viraria "total"
  const preambulo = grid.slice(0, Math.max(0, (headerRow ?? 30) - 1))
  let aberta = null
  let totalImpresso = null
  let vencimento = null

  for (const row of preambulo) {
    const n = norm(row.map((c) => String(c ?? '')).join(' '))
    if (aberta === null && /\bfatura\b/.test(n)) {
      if (/\baberta\b|valor ate o momento/.test(n)) aberta = true
      else if (/\bfechada\b|fatura paga/.test(n)) aberta = false
    }

    /*
     * O valor mora numa linha SEPARADA do rotulo na fatura fechada:
     *
     *   [7] Fatura Fechada - <mes>/<ano>
     *   [8] Cartao | Valor | Vencimento
     *   [9] <nome do cartao> | R$ <total> | <vencimento>
     *
     * Procurar so na linha do rotulo achava o total da ABERTA (onde os dois
     * dividem a linha) e NUNCA o da fechada. Ancorar no "R$" explicito evita
     * confundir com o numero do cartao ou com data serializada.
     */
    if (totalImpresso === null) {
      for (let j = 0; j < row.length; j++) {
        const cru = String(row[j] ?? '')
        if (!/R\$/.test(cru)) continue
        const v = parseValue(cru)
        if (v === null || Math.abs(v) <= 1000) continue
        totalImpresso = Math.abs(v)
        // o vencimento e o vizinho na MESMA linha — pegar a primeira data do
        // preambulo trazia o "Atualizacao: 14/08/2026" da fatura aberta
        for (const c of row.slice(j + 1)) {
          const d = String(c ?? '').match(/^(\d{2}\/\d{2}\/\d{4})/)
          if (d) { vencimento = parseDate(d[1]); break }
        }
        break
      }
    }
  }
  return { aberta: aberta ?? false, totalImpresso, vencimento }
}

function monthShift(m, k) {
  const t = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + k
  const yy = Math.floor(t / 12), mm = ((t % 12) + 12) % 12
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------- reconciliacao

const DIAS = 3

/**
 * Casa o que voce digitou no mes com o que veio na fatura.
 *
 * Sem isto, todo gasto lancado a mao aparece DUAS vezes quando a fatura chega —
 * o mes fecha inflado e o app perde a confianca em tres semanas. Casamento por
 * (valor exato) + (data +-3 dias, porque a compra demora a postar) + (lojista
 * parecido). O que nao casar fica listado pra voce decidir, nunca some sozinho.
 */
export function reconcile(statementTxns, manualEntries) {
  const usados = new Set()
  const pares = []
  const soltos = []

  for (const m of manualEntries ?? []) {
    const alvo = statementTxns.findIndex((t, i) => {
      if (usados.has(i) || t.kind !== 'purchase') return false
      if (t.cents !== m.cents) return false
      const dd = Math.abs(diasEntre(t.date, m.date))
      if (dd > DIAS) return false
      return parecido(t.mkey, m.mkey ?? merchantKey(m.desc))
    })
    if (alvo >= 0) { usados.add(alvo); pares.push({ manual: m, fatura: statementTxns[alvo] }) }
    else soltos.push(m)
  }
  return { pares, soltos }
}

function diasEntre(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00') - Date.parse(b + 'T00:00:00')) / 86400000)
}

/** Prefixo comum de 4+ chars ou um contido no outro — o extrato abrevia. */
function parecido(a, b) {
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  const n = Math.min(a.length, b.length, 6)
  return n >= 4 && a.slice(0, n) === b.slice(0, n)
}
