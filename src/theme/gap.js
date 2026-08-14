// Paleta GAP — espelho de I:\Erico\App Master\frontend\src\theme\gap.js
export const GAP = {
  blue: '#00A2FF',
  navy: '#0a1628',
  navy2: '#1a2d4a',
  red: '#e74c3c',
  green: '#27ae60',
  bg: '#f5f7fa',
  surface: '#ffffff',
  border: '#e2e8f0',
  text: '#0a1628',
  muted: '#64748b',
  soft: '#f7fafd',
  grid: '#e8eef4',
}

export const GAP_SERIES = [
  '#00A2FF', '#0a1628', '#e74c3c', '#27ae60', '#8b5cf6',
  '#f59e0b', '#0ea5e9', '#ec4899', '#14b8a6', '#64748b',
]

/**
 * Casas decimais sempre sanitizadas.
 *
 * Sem isso, escrever `fmt: money` em vez de `fmt: (c) => money(c)` explode: o
 * GapTable chama `fmt(valor, linha)` e o OBJETO da linha vira o `dec`, e o
 * Intl responde "invalid digits value: NaN" — o mesmo pe na jaca de
 * `['1','2','3'].map(parseInt)`. Formatador nao deve derrubar tela por isso.
 */
function safeDec(dec, fallback = 2) {
  const n = Number(dec)
  return Number.isFinite(n) ? Math.min(20, Math.max(0, Math.trunc(n))) : fallback
}

export function brNum(x, dec = 2) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  const d = safeDec(dec)
  return Number(x).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function brSigned(x, dec = 1) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  const v = Number(x)
  return (v > 0 ? '+' : '') + brNum(v, dec)
}

// O banco guarda centavos inteiros — nunca float — pra nao acumular erro.
// Toda formatacao de dinheiro passa por aqui.
export function money(cents, dec = 2) {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—'
  return 'R$ ' + brNum(Number(cents) / 100, dec)
}

export function moneyShort(cents) {
  if (cents === null || cents === undefined) return '—'
  const v = Number(cents) / 100
  if (Math.abs(v) >= 1000) return 'R$ ' + brNum(v / 1000, 1) + 'k'
  return 'R$ ' + brNum(v, 0)
}

export function moneySigned(cents, dec = 2) {
  if (cents === null || cents === undefined) return '—'
  const v = Number(cents)
  return (v > 0 ? '+' : v < 0 ? '−' : '') + 'R$ ' + brNum(Math.abs(v) / 100, dec)
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** '2026-08' -> 'ago/26' */
export function monthLabel(m) {
  if (!m) return '—'
  const [y, mo] = m.split('-')
  return `${MESES[Number(mo) - 1]}/${y.slice(2)}`
}
