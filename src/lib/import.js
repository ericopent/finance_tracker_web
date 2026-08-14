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

/** Parser de CSV com aspas, BOM e delimitador detectado (`,` ou `;`). */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!clean.trim()) return { header: [], rows: [] }

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

  const header = (rows.shift() ?? []).map((h) => h.trim())
  return { header, rows: rows.filter((r) => r.some((c) => String(c).trim())) }
}

const norm = (s) =>
  String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Descobre quais colunas sao data / descricao / valor. */
export function detectColumns(header) {
  const h = header.map(norm)
  const find = (cands) => h.findIndex((x) => cands.some((c) => x === c || x.includes(c)))
  return {
    date: find(['data', 'date', 'dt']),
    desc: find(['lancamento', 'descricao', 'description', 'historico', 'estabelecimento', 'title']),
    value: find(['valor', 'amount', 'value', 'quantia']),
  }
}

// ---------------------------------------------------------------- valores e datas

/** Aceita "1.234,56", "1234.56", "-45,90", "(45,90)" (negativo contabil). */
export function parseValue(raw) {
  let s = String(raw ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
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

/** Mes de referencia pelo nome do arquivo: fatura-20260605.csv -> 2026-06 */
export function refMonthFromName(name) {
  const m = String(name ?? '').match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})?/)
  return m ? `${m[1]}-${m[2]}` : null
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

/**
 * Transforma linhas cruas na fatura estruturada.
 * `anchorFor` resolve a ancora do contrato parcelado: mes da fatura menos
 * (parcela atual - 1), igual ao backfill.
 */
export function buildStatement({ header, rows, refMonth, config, fileName }) {
  const col = detectColumns(header)
  if (col.desc < 0 || col.value < 0) {
    throw new Error(
      `Não achei as colunas necessárias.\nCabeçalho lido: ${header.join(' | ') || '(vazio)'}\n` +
      `Preciso de uma coluna de descrição (lançamento/descrição) e uma de valor.`
    )
  }
  const ref = refMonth || refMonthFromName(fileName)
  if (!ref) throw new Error('Não consegui deduzir o mês da fatura. Escolha no seletor.')

  const txns = []
  const problemas = []
  rows.forEach((r, i) => {
    const desc = String(r[col.desc] ?? '').trim()
    const cents = parseValue(r[col.value])
    if (!desc || cents === null) {
      if (desc || r.some((c) => String(c).trim())) problemas.push({ linha: i + 2, motivo: 'valor ilegível', raw: r.join(' | ').slice(0, 70) })
      return
    }
    const date = (col.date >= 0 ? parseDate(r[col.date]) : null) ?? `${ref}-01`
    const kind = classifyKind(desc, cents)
    const { cat, sub, via } = kind === 'purchase' ? classify(desc, config) : { cat: null, sub: null, via: null }

    const p = desc.match(PARCELA)
    let ino = null, itot = null, igrp = null
    if (p) {
      ino = Number(p[1]); itot = Number(p[2])
      const anchor = monthShift(ref, -(ino - 1))
      igrp = `${merchantKey(desc)}|${itot}|${anchor}|${Math.abs(cents)}`
    }

    txns.push({
      date, desc, mkey: merchantKey(desc), cents: Math.abs(cents),
      kind, cat, sub, ino, itot, igrp, cash: ref, via,
    })
  })

  return { ref, txns, problemas, fileName: fileName ?? null }
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
