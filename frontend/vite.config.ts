import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 部署在子路径（如 https://域名/traffic/）时使用。
  // 如果以后部署到根目录，改回 '/' 即可。
  base: process.env.VITE_BASE_PATH ?? '/traffic/',
})
