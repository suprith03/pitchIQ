import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const apiTarget = env.VITE_API_PROXY_TARGET ?? `http://localhost:${env.API_PORT || '4000'}`

  return {
    envDir: projectRoot,
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/graphql': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'charts', test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+)[\\/]/ },
              { name: 'apollo', test: /node_modules[\\/](@apollo|graphql)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
  }
})
