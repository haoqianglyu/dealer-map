import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import https from 'node:https'

// 开发代理到平台：本机到 106.14.238.28 丢包严重——部分新建连接 SYN 无回应、部分已建连接上请求 10–40 s 无响应，直连 curl / node 一样，
// 不是代码问题；生产走 Worker 不受影响。这里每个请求原本都可能新建连接撞上它 → 60 s 超时 →「告警加载失败」。
// 对策（仅开发，只能减轻建连那一半）：keep-alive 复用连接；新建连接 3 s 内没完成 TLS 握手就换端口重连（最多 5 次）。
class RetryAgent extends https.Agent {
  createConnection(options, cb) {
    let tries = 0
    const attempt = () => {
      let settled = false
      const sock = super.createConnection(options)
      const timer = setTimeout(() => {
        settled = true
        sock.destroy()
        if (++tries < 5) attempt()
        else cb(new Error('upstream connect timeout'))
      }, 3000)
      sock.once('secureConnect', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cb(null, sock)
      })
      sock.once('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cb(e)
      })
    }
    attempt()
  }
}
const upstreamAgent = new RetryAgent({ keepAlive: true })

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
