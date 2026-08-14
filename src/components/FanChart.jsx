import { GAP, monthLabel, moneyShort } from '../theme/gap'

/**
 * Fan chart em SVG.
 *
 * Plotly faria isso, mas custa ~1,4 MB gzipados e o alvo aqui e celular. Sao
 * duas formas: um poligono p10-p90 e uma linha p50. Nao vale um motor de
 * graficos inteiro.
 *
 * pontos: [{ month, p10, p50, p90 }] em CENTAVOS.
 */
export default function FanChart({ pontos = [], height = 240, zero = true }) {
  if (!pontos.length) return null

  const W = 720, H = height, ML = 52, MR = 12, MT = 12, MB = 26
  const iw = W - ML - MR, ih = H - MT - MB

  const vals = pontos.flatMap((p) => [p.p10, p.p50, p.p90])
  let min = Math.min(...vals, zero ? 0 : Infinity)
  let max = Math.max(...vals, zero ? 0 : -Infinity)
  if (min === max) { min -= 1000; max += 1000 }
  const pad = (max - min) * 0.08
  min -= pad; max += pad

  const x = (i) => ML + (pontos.length === 1 ? iw / 2 : (i / (pontos.length - 1)) * iw)
  const y = (v) => MT + ih - ((v - min) / (max - min)) * ih

  const banda = [
    ...pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p90).toFixed(1)}`),
    ...pontos.slice().reverse().map((p, j) => {
      const i = pontos.length - 1 - j
      return `L${x(i).toFixed(1)},${y(p.p10).toFixed(1)}`
    }),
    'Z',
  ].join(' ')

  const linha = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p50).toFixed(1)}`).join(' ')

  // 4 marcas no eixo Y, em valores redondos
  const ticks = []
  for (let k = 0; k <= 4; k++) ticks.push(min + ((max - min) * k) / 4)

  const yZero = min <= 0 && max >= 0 ? y(0) : null
  const passo = Math.ceil(pontos.length / 6) // no celular nao cabe 12 rotulos

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} stroke={GAP.grid} strokeWidth="1" />
          <text x={ML - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={GAP.muted}>
            {moneyShort(t)}
          </text>
        </g>
      ))}

      {yZero !== null && (
        <line x1={ML} x2={W - MR} y1={yZero} y2={yZero} stroke={GAP.red} strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
      )}

      <path d={banda} fill={GAP.blue} opacity="0.15" />
      <path d={linha} fill="none" stroke={GAP.blue} strokeWidth="2.2" strokeLinejoin="round" />

      {pontos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.p50)} r="2.8" fill={GAP.surface} stroke={GAP.blue} strokeWidth="1.8" />
      ))}

      {pontos.map((p, i) =>
        i % passo === 0 || i === pontos.length - 1 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={GAP.muted}>
            {monthLabel(p.month)}
          </text>
        ) : null
      )}
    </svg>
  )
}
