import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 与 bigscreen_fable 相同的代理方式：/api → 平台 /v1（注意：目标是生产环境）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 8090,
    proxy: {
      '/api': {
        target: 'https://control.cosyhome.com.cn/v1',
        secure: false,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
