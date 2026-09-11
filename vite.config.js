import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from the pierced-up.com custom domain at the root, not a GitHub
  // Pages project sub-path, so no prefix is needed here.
  base: '/',
  plugins: [react()],
})
