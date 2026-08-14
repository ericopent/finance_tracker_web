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
  resetWriteCache() // trocou de repo/token: o que achavamos ter gravado nao vale
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
    // A API responde com `Cache-Control: private, max-age=60`. Sem no-store o
    // navegador serve o GET do cache por 1 minuto, entao depois de gravar a
    // releitura devolve o sha VELHO e todo PUT seguinte leva 409 — inclusive as
    // tentativas de retry, que batiam todas na mesma resposta cacheada.
    cache: 'no-store',
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
  if (res.status === 409 || res.status === 422) {
    // conflito de sha — quem chama (readModifyWrite) relê e tenta de novo
    const e = new Error(
      'Alguém (ou outro aparelho) gravou nesse arquivo ao mesmo tempo. ' +
      'Tentei reaplicar e não consegui — recarregue e refaça.'
    )
    e.code = res.status
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

/** Lista um diretorio. Devolve [] se ainda nao existir (1o import). */
export async function listDir(path) {
  try {
    const r = await gh(`/repos/${getRepo()}/contents/${path}?ref=${BRANCH}`)
    return Array.isArray(r) ? r : []
  } catch (e) {
    if (e.code === 404) return []
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

// ---------------------------------------------------------------- escrita concorrente

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fila por arquivo.
 *
 * Dois toques seguidos (confirmar dois recorrentes em sequencia) faziam o
 * segundo LER o sha antes de o primeiro terminar de GRAVAR — os dois mandavam
 * o mesmo sha e o segundo levava 409. Serializar por caminho elimina a corrida
 * na origem; o retry abaixo cobre so o resto (outro aparelho, ou leitura
 * obsoleta da API logo apos um PUT).
 */
const filas = new Map()
function serial(path, fn) {
  const anterior = filas.get(path) ?? Promise.resolve()
  const proxima = anterior.catch(() => {}).then(fn)
  filas.set(path, proxima.catch(() => {}))
  return proxima
}

/**
 * Le-muta-grava com retry em conflito.
 *
 * `mutate` PRECISA ser reaplicavel: em conflito, relemos o arquivo do zero e
 * chamamos de novo. Por isso as mutacoes sao "filtra e insere", nunca
 * "incrementa" — reaplicar um incremento contaria duas vezes.
 */
/**
 * Estado do que ESTE cliente gravou por ultimo.
 *
 * Depois de um PUT bem-sucedido a API devolve o sha novo. Guardar sha+conteudo
 * evita depender da releitura, que e o caminho mais fragil: mesmo com no-store
 * o servidor pode levar um instante pra refletir a escrita. Se outro aparelho
 * gravar, o PUT da 409, o cache e descartado e a proxima volta relendo.
 */
const ultimoEscrito = new Map()

async function baseAtual(path) {
  const c = ultimoEscrito.get(path)
  if (c) return c
  const cur = await readFile(path)
  return { sha: cur?.sha, text: cur?.text ?? null }
}

async function readModifyWrite(path, transform, message, tries = 5) {
  return serial(path, async () => {
    let ultimo
    for (let i = 0; i < tries; i++) {
      const cur = await baseAtual(path)
      const next = transform(cur.text)
      if (next === null) return null
      try {
        const res = await writeFile(path, next, cur.sha, message)
        const novoSha = res?.content?.sha
        if (novoSha) ultimoEscrito.set(path, { sha: novoSha, text: next })
        else ultimoEscrito.delete(path)
        return res
      } catch (e) {
        ultimo = e
        // o que estava em cache nao vale mais — proxima volta rele do servidor
        ultimoEscrito.delete(path)
        const conflito = e.code === 409 || e.code === 422
        if (!conflito || i === tries - 1) throw e
        await sleep(500 * (i + 1))
      }
    }
    throw ultimo
  })
}

/** Invalida o que este cliente acha que gravou (usar ao trocar de token/repo). */
export function resetWriteCache() {
  ultimoEscrito.clear()
}

/** Append numa linha de JSONL. */
export async function appendJsonl(path, obj, message) {
  return readModifyWrite(path, (base) => {
    const b = base ?? ''
    const sep = b && !b.endsWith('\n') ? '\n' : ''
    return b + sep + JSON.stringify(obj) + '\n'
  }, message)
}

/** Le, muta e grava um JSON inteiro. */
export async function updateJson(path, mutate, message, vazio = {}) {
  return readModifyWrite(path, (text) => {
    let obj
    try { obj = text ? JSON.parse(text) : { ...vazio } } catch { obj = { ...vazio } }
    mutate(obj)
    return JSON.stringify(obj, null, 2)
  }, message)
}

/** Sobrescreve um JSON inteiro (fatura importada), com sha fresco e retry. */
export async function putJson(path, obj, message) {
  return readModifyWrite(path, () => JSON.stringify(obj), message)
}

/** Reescreve o JSONL sem certas linhas (apagar lancamento, reconciliar). */
export async function rewriteJsonl(path, keepFn, message) {
  return readModifyWrite(path, (text) => {
    if (text === null) return null
    const kept = parseJsonl(text).filter(keepFn)
    return kept.map((o) => JSON.stringify(o)).join('\n') + (kept.length ? '\n' : '')
  }, message)
}

export function parseJsonl(text) {
  if (!text) return []
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
