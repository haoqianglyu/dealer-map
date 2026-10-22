import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import https from 'node:https'

// 开发代理到平台：本机到 106.14.238.28 的 TCP 建连约 1/3 丢 SYN（直连 curl 同样卡到超时，非代码问题），
// 每个请求新建连接时就会偶发 60 s 超时 →「告警加载失败」。keep-alive 复用已建好的连接，绕开大部分建连。
const upstreamAgent = new https.Agent({ keepAlive: true, maxSockets: 8 })

// 与 bigscreen_fable 相同的代理方式：/api → 平台 /v1（注意：目标是生产环境）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
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
        agent: upstreamAgent,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 共享坐标缓存（生产走 Worker /geo-shared）；FC 地址放 .env.local 的 GEO_FC_URL
      ...(env.GEO_FC_URL
        ? { '/geo-shared': { target: env.GEO_FC_URL, changeOrigin: true, secure: true, rewrite: () => '/geo' } }
        : {}),
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
  }
})
