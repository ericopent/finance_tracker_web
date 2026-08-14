import React from 'react'
import { clearAuth } from '../lib/github'

/**
 * Sem isto, QUALQUER excecao no render desmonta a arvore inteira e o usuario ve
 * uma tela branca — o pior estado possivel, porque nao diz nada e no celular
 * nao da pra abrir o console. Aqui o erro vira texto na tela.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null, info: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    console.error('[finance-tracker]', err, info)
    this.setState({ info })
  }

  render() {
    const { err, info } = this.state
    if (!err) return this.props.children

    return (
      <div className="min-h-full p-5 bg-gap-bg">
        <div className="gap-card max-w-[560px] mx-auto p-4">
          <h1 className="text-[15px] font-bold text-gap-red mb-1">O app quebrou</h1>
          <p className="text-[12px] text-gap-muted mb-3">
            Manda esse texto pro Claude que ele conserta.
          </p>

          <pre className="text-[11px] bg-gap-soft border border-gap-border rounded-md p-2.5 overflow-auto max-h-[40vh] whitespace-pre-wrap break-words">
{String(err?.message ?? err)}
{err?.stack ? '\n\n' + err.stack.split('\n').slice(0, 6).join('\n') : ''}
{info?.componentStack ? '\n\ncomponente:' + info.componentStack.split('\n').slice(0, 5).join('\n') : ''}
          </pre>

          <div className="flex gap-2 mt-3">
            <button className="gap-btn" onClick={() => location.reload()}>Recarregar</button>
            <button
              className="gap-btn !bg-gap-muted"
              onClick={() => { clearAuth(); location.reload() }}
            >
              Sair e limpar token
            </button>
          </div>
        </div>
      </div>
    )
  }
}
