import { lazy, Suspense } from 'react'
import { GAP } from '../theme/gap'

// plotly e ~3.5MB — lazy pra so baixar quem abre pagina com grafico
const Plot = lazy(() => import('react-plotly.js'))

export default function PlotlyChart({
  data = [], layout = {}, height = 420, title, yTitle = '', ySuffix = '', config,
}) {
  const { xaxis, yaxis, ...restLayout } = layout
  const merged = {
    template: 'plotly_white',
    paper_bgcolor: GAP.surface,
    plot_bgcolor: GAP.surface,
    height,
    margin: { l: 62, r: 18, t: title ? 44 : 24, b: 52 },
    font: { family: "'Mulish Variable', 'Inter Variable', 'Segoe UI', sans-serif", color: GAP.navy, size: 11.5 },
    title: title ? { text: title, font: { size: 14, color: GAP.navy }, x: 0, xanchor: 'left', y: 0.98 } : undefined,
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.01, xanchor: 'right', x: 1, font: { size: 11, color: GAP.muted } },
    ...restLayout,
    xaxis: { tickfont: { size: 11.5, color: GAP.muted }, gridcolor: GAP.grid, ...(xaxis || {}) },
    yaxis: {
      title: yTitle ? { text: yTitle, font: { size: 11.5, color: GAP.muted } } : undefined,
      ticksuffix: ySuffix,
      tickfont: { size: 11.5, color: GAP.muted },
      gridcolor: GAP.grid,
      ...(yaxis || {}),
    },
  }
  return (
    <Suspense fallback={<div style={{ height }} className="flex items-center justify-center text-gap-muted text-[12px]">carregando gráfico…</div>}>
      <Plot data={data} layout={merged} config={{ displayModeBar: false, responsive: true, ...config }} style={{ width: '100%' }} useResizeHandler />
    </Suspense>
  )
}
