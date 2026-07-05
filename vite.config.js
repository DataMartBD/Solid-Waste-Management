import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://alam689.github.io/Solid-Waste-Management-System/ on GitHub Pages.
export default defineConfig({
  base: '/Solid-Waste-Management-System/',
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
  },
})
