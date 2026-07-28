import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Forward API calls to the FastAPI backend during local dev, so the
      // frontend can call e.g. fetch('/api/schools') without hardcoding a
      // host/port.
      '/api': 'http://localhost:8000',
    },
  },
})
