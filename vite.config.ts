import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 部署到子路径（如 GitHub Pages 的 /repo-name/）时用 VITE_BASE 覆盖，默认部署在根路径
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    // 监听双栈（IPv4 + IPv6），避免预览代理按 localhost → ::1 解析时连不上
    host: '::',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
