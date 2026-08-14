/**
 * Cliente da API do GitHub — o repo privado e o banco de dados.
 *
 * O site publicado e estatico e nao contem nenhum numero seu: TODO dado vem
 * daqui, autenticado. Quem abrir a URL sem token ve a tela de login e nada mais.
 *
 * Token: fine-grained PAT com escopo NESSE repo, permissao Contents read/write.
 * Fica no localStorage do aparelho. Perdeu o celular -> revoga o token no
 * github.com e o acesso morre, sem precisar mexer no app.
 */

const API = 'https://api.github.com'

const LS_TOKEN = 'ft.token'
const LS_REPO = 'ft.repo'

export const DEFAULT_REPO = 'ericopent/finance_tracker'
export const BRANCH = 'main'

export const getToken = () => localStorage.getItem(LS_TOKEN) ?? ''
export const getRepo = () => localStorage.getItem(LS_REPO) || DEFAULT_REPO
export function setAuth(token, repo) {
  localStorage.setItem(LS_TOKEN, token.trim())
  localStorage.setItem(LS_REPO, (repo || DEFAULT_REPO).trim())
}
export function clearAuth() {
  localStorage.removeItem(LS_TOKEN)
  localStorage.removeItem(LS_REPO)
}

// ---------------------------------------------------------------- base64 utf-8

// btoa() so aceita latin-1; sem passar por TextEncoder, "Padaria do Zé" corrompe.
function b64encode(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

// ---------------------------------------------------------------- http

async function gh(path, opts = {}) {
  const token = getToken()
  if (!token) throw new Error('sem token')
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  })
  if (res.status === 401) throw new Error('Token inválido ou expirado. Gere outro no github.com.')
  if (res.status === 403) {
    // Distinguir leitura de escrita importa: o caso comum e token criado com
    // Contents "Read-only", que le tudo e falha so na hora de gravar.
    const escrita = opts.method && opts.method !== 'GET'
    throw new Error(
      escrita
        ? 'Token é somente leitura.\n\nNo GitHub, edite o token e ponha ' +
          'Repository permissions → Contents em "Read and write" (não "Read-only"). ' +
          'Depois recarregue.'
        : 'Token sem permissão de leitura em Contents nesse repositório.'
    )
  }
  if (res.status === 404) {
    // Pode ser arquivo inexistente (esperado em manual.jsonl no 1o uso) ou
    // token sem acesso ao repo. Quem chama decide — readFile trata como null.
    const e = new Error(`Não encontrado: ${path.split('?')[0]}`)
    e.code = 404
    throw e
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    const e = new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`)
    e.code = res.status
    throw e
  }
  return res.status === 204 ? null : res.json()
}

/** Aceita "owner/repo", URL colada do navegador, com ou sem .git. */
export function normalizeRepo(input) {
  return String(input ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
}

/**
 * Confere o token em DOIS passos, porque 404 sozinho nao diz nada.
 *
 * A API devolve 404 (nao 403) quando o token e valido mas nao alcanca o repo —
 * negar a existencia evita revelar repo privado pra quem nao deveria saber.
 * Efeito colateral: "nao encontrado" vira a mensagem mais inutil possivel.
 * Perguntando /user antes, da pra separar "token ruim" de "token bom sem acesso"
 * e dizer exatamente qual campo do GitHub esta errado.
 */
export async function checkAuth(token, repoInput) {
  const repo = normalizeRepo(repoInput)
  const prev = { t: getToken(), r: getRepo() }
  setAuth(token, repo)

  const [owner, name] = repo.split('/')
  if (!owner || !name) {
    setAuth(prev.t, prev.r)
    throw new Error('Repositório deve ser no formato usuario/repo')
  }

  try {
    const me = await gh('/user') // 401 aqui = token invalido/expirado
    try {
      const r = await gh(`/repos/${repo}`)
      return { ok: true, private: r.private, full_name: r.full_name, login: me.login }
    } catch (e) {
      if (e.code === 404) {
        throw new Error(
          `Token válido (entrou como ${me.login}), mas ele não enxerga "${repo}".\n\n` +
          `Quase sempre é o bloco "Repository access", que fica ACIMA das permissões ` +
          `e vem no padrão "Public repositories" — troque para "Only select repositories" ` +
          `e marque "${name}".\n\n` +
          `Confira também se o "Resource owner" é "${owner}".`
        )
      }
      throw e
    }
  } catch (e) {
    setAuth(prev.t, prev.r)
    throw e
  }
}

// ---------------------------------------------------------------- arquivos

/** Le um arquivo do repo. Devolve {text, sha} ou null se nao existir. */
export async function readFile(path) {
  try {
    const r = await gh(`/repos/${getRepo()}/contents/${path}?ref=${BRANCH}`)
    return { text: b64decode(r.content), sha: r.sha }
  } catch (e) {
    if (e.code === 404) return null
    throw e
  }
}

export async function writeFile(path, text, sha, message) {
  const body = {
    message: message ?? `update ${path}`,
    content: b64encode(text),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  }
  return gh(`/repos/${getRepo()}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * Append numa linha de JSONL, com retry em conflito.
 *
 * Dois aparelhos podem gravar quase junto; o segundo PUT leva 409 porque o sha
 * envelheceu. Reler-e-reaplicar resolve sem perder lancamento — o que NAO pode
 * acontecer e o segundo sobrescrever o primeiro em silencio.
 */
export async function appendJsonl(path, obj, message, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const cur = await readFile(path)
    const base = cur?.text ?? ''
    const sep = base && !base.endsWith('\n') ? '\n' : ''
    const next = base + sep + JSON.stringify(obj) + '\n'
    try {
      return await writeFile(path, next, cur?.sha, message)
    } catch (e) {
      const conflict = e.code === 409 || e.code === 422
      if (!conflict || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
}

/** Reescreve o JSONL sem uma linha (usado pra apagar lancamento). */
export async function rewriteJsonl(path, keepFn, message, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const cur = await readFile(path)
    if (!cur) return null
    const kept = cur.text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
      .filter(keepFn)
    const next = kept.map((o) => JSON.stringify(o)).join('\n') + (kept.length ? '\n' : '')
    try {
      return await writeFile(path, next, cur.sha, message)
    } catch (e) {
      const conflict = e.code === 409 || e.code === 422
      if (!conflict || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
}

export function parseJsonl(text) {
  if (!text) return []
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
