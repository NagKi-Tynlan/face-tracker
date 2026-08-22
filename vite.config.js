import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Project site, not a user site: GitHub Pages serves this from the /face-tracker/
  // sub-path, so asset URLs have to be built with that prefix or every request
  // 404s. Vite rewrites root-absolute URLs in index.html to match; files copied
  // verbatim out of public/ do not get that treatment and hardcode the prefix.
  base: '/face-tracker/',
  plugins: [react()],
})
