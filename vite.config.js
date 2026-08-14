import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages de repo de projeto serve em /<repo>/, nao na raiz — sem `base`
// os assets viram 404 em producao e a pagina abre em branco.
// BASE_PATH e injetado pelo workflow; em dev fica '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  server: { port: 1421, strictPort: true },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // plotly num chunk proprio: o celular so baixa se abrir tela com grafico
        manualChunks: (id) => (id.includes('plotly') ? 'plotly' : undefined),
      },
    },
  },
})
