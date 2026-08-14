/**
 * Le valor digitado em pt-BR e devolve CENTAVOS inteiros.
 *
 * Aceita: "45,90"  "1.234,56"  "45.90"  "1234"  "R$ 89,90"
 * O ponto e ambiguo — em "1.234" e milhar, em "45.90" e decimal. A regra
 * segue o que a pessoa quis dizer: ponto com exatamente 2 digitos depois e
 * decimal, qualquer outra coisa e separador de milhar.
 */
export function parseMoney(input) {
  if (input === null || input === undefined) return null
  let s = String(input).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!s) return null
  if (!/^[\d.,]+$/.test(s)) return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // o ultimo separador manda
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasDot) {
    const parts = s.split('.')
    // "45.90" -> decimal ; "1.234" ou "1.234.567" -> milhar
    if (!(parts.length === 2 && parts[1].length === 2)) s = s.replace(/\./g, '')
  }

  const v = Number(s)
  if (!Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100)
}

/** Data local em ISO (YYYY-MM-DD) — sem passar por UTC, que puxa pro dia anterior. */
export function todayISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
