import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const appVersion =
  process.env.VITE_APP_VERSION ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.COMMIT_REF ||
  process.env.GITHUB_SHA ||
  'dev'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
