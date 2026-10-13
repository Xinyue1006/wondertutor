import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Component tests run in a simulated browser (jsdom)
  test: { environment: 'jsdom', globals: true, setupFiles: './src/tests/setup.js', css: false },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
