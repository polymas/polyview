import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 允许外部访问
    port: parseInt(process.env.VITE_PORT || '8001'),
    proxy: {
      // 将 /api 开头的请求代理到后端
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false, // 如果是https，设置为false
        ws: true, // 支持websocket
        timeout: 60000, // 超时时间60秒
      },
    },
  },
})


