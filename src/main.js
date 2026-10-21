import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/global.scss'

createApp(App).use(router).mount('#app')

// 新版本部署后，旧页面预加载的 chunk 可能已不存在：刷新一次拿新版（10 秒内不重复刷新）
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem('dm_preload_reload')) || 0
  if (Date.now() - last > 10000) {
    sessionStorage.setItem('dm_preload_reload', String(Date.now()))
    e.preventDefault()
    location.reload()
  }
})
