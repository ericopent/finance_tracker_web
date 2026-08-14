# finance_tracker_web

Front-end do meu tracker de finanças pessoais. **Só código — nenhum dado.**

Site estático (React + Vite) publicado no GitHub Pages. Os dados ficam num
repositório **privado** separado e são lidos direto no aparelho, pela API do
GitHub, com um token fine-grained que o usuário cola uma vez.

Quem abrir a URL sem token vê a tela de login e mais nada. É por isso que este
repositório pode ser público sem expor nada: ele não tem número nenhum dentro.

## Como funciona

```
   navegador do celular
      │
      ├── site estático  ← GitHub Pages (público, só JS/CSS)
      │
      └── fetch autenticado ──→ repo PRIVADO de dados
                                  data/ledger.json    histórico importado
                                  data/manual.jsonl   gastos lançados no celular
                                  data/config.json    recorrentes e renda
```

Não há servidor. A projeção (parcelas, recorrentes, faixa p10/p50/p90) roda no
próprio navegador, em [src/lib/engine.js](src/lib/engine.js).

## Rodar local

```bash
npm install
npm run dev     # http://localhost:1421
```

## Deploy

Push na `main` dispara o workflow, que faz build e publica no Pages. O build
aborta se encontrar dado financeiro dentro do `dist/`.

## Notas de design

- **Plotly não entra na tela principal.** Custa ~1,4 MB gzipados; a faixa
  p10/p50/p90 é CSS puro. O carregamento inicial fica em ~76 KB.
- **`HashRouter`, não `BrowserRouter`.** Pages não faz fallback de SPA; sem hash,
  recarregar numa rota profunda dá 404.
- **`base` dinâmico no Vite.** Pages de repo de projeto serve em `/<repo>/`.
- O token vive no `localStorage` do aparelho. Perdeu o celular → revoga no
  github.com e o acesso morre, sem mexer no app.
