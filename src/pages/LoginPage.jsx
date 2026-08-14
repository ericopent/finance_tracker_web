import { useState } from 'react'
import { KeyRound, ShieldCheck, ExternalLink } from 'lucide-react'
import { checkAuth, DEFAULT_REPO } from '../lib/github'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

export default function LoginPage({ onOk }) {
  const [token, setToken] = useState('')
  const [repo, setRepo] = useState(DEFAULT_REPO)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState(null)

  const entrar = async (e) => {
    e?.preventDefault()
    setBusy(true); setErro(null)
    try {
      const r = await checkAuth(token, repo)
      if (!r.private) {
        setErro('atenção: esse repo é PÚBLICO — seus dados ficariam abertos. Use um repo privado.')
        setBusy(false)
        return
      }
      onOk()
    } catch (e) {
      setErro(String(e.message ?? e))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-5 bg-gap-bg">
      <form onSubmit={entrar} className="gap-card w-full max-w-[440px] p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={17} className="text-gap-blue" />
          <h1 className="text-[17px] font-bold text-gap-navy">Finance Tracker</h1>
        </div>
        <p className="text-[12.5px] text-gap-muted mb-4">
          Este site não guarda nada. Os dados moram no seu repositório privado e
          são lidos com o seu token, direto no aparelho.
        </p>

        <label className="gap-label">Repositório de dados</label>
        <input className="gap-input w-full mb-3" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="usuario/repo" />

        <label className="gap-label">Token</label>
        <input
          className="gap-input w-full font-mono text-[12px]"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_..."
        />

        <a
          href={TOKEN_URL} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11.5px] text-gap-blue hover:underline mt-1.5"
        >
          criar um token fine-grained <ExternalLink size={11} />
        </a>
        <div className="text-[11px] text-gap-muted mt-1 leading-relaxed">
          Escopo mínimo: <b>Only select repositories</b> → esse repo →
          Repository permissions → <b>Contents: Read and write</b>. Nada além disso.
        </div>

        {erro && <div className="mt-3 text-[12px] text-gap-red font-semibold">{erro}</div>}

        <button className="gap-btn w-full mt-4" disabled={busy || !token.trim()}>
          {busy ? 'verificando…' : 'Entrar'}
        </button>

        <div className="flex items-start gap-1.5 text-[11px] text-gap-muted mt-3">
          <ShieldCheck size={13} className="shrink-0 mt-px" />
          <span>
            O token fica só neste aparelho (localStorage). Perdeu o celular? Revogue
            o token no github.com e o acesso morre na hora.
          </span>
        </div>
      </form>
    </div>
  )
}
