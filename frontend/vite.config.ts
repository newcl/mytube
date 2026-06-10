import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const explicitVersion = process.env.VITE_APP_VERSION
const commitSha =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.COMMIT_REF ||
  process.env.GITHUB_SHA ||
  ''
const commitShort = commitSha ? commitSha.slice(0, 7) : ''
const buildTimeUtc =
  process.env.VITE_BUILD_TIME_UTC ||
  new Date().toISOString().replace(/[-:]/g, '').slice(0, 12) + 'Z'

const appVersion = explicitVersion || (commitShort ? `${commitShort}-${buildTimeUtc}` : 'dev')

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
