import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind to all interfaces so the dev server is reachable inside Docker.
    // Has no effect when running on the host directly.
    host: true,
    port: 5173,
    // Allow any hostname (corporate FQDNs, container names, etc.).
    // Network-level access control is handled outside Vite in dev.
    allowedHosts: true,
    proxy: {
      '/api': {
        // Override with API_PROXY_TARGET when running inside Docker so the
        // proxy resolves 'api' (the compose service name) rather than localhost.
        // Set in docker-compose.dev.yml: API_PROXY_TARGET=http://api:8000
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
