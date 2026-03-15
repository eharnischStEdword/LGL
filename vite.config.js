import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api/lgl-data': {
        target: 'https://stedward.littlegreenlight.com',
        changeOrigin: true,
        rewrite: () => '/rptlink/5957dd30-a1b2-402b-b30a-3bd21e02f604',
      },
    },
  },
})
