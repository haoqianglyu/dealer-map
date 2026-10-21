import { createRouter, createWebHashHistory } from 'vue-router'
import { session } from '@/api/session'

const routes = [
  { path: '/', redirect: '/dealer-map' },
  { path: '/login', component: () => import('@/views/Login.vue') },
  { path: '/dealer-map', component: () => import('@/views/DealerMap.vue') },
  { path: '/project/:id', component: () => import('@/views/ProjectDetail.vue') },
]

const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  if (to.path === '/login') return true
  if (!session.token()) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})

// 部署新版本后旧标签页按需加载旧 chunk 会 404：自动刷新一次拿新版
router.onError((e) => {
  if (/dynamically imported module|Importing a module script failed/.test(e?.message || '') && !sessionStorage.getItem('dm_chunk_reload')) {
    sessionStorage.setItem('dm_chunk_reload', '1')
    location.reload()
  }
})
router.afterEach(() => sessionStorage.removeItem('dm_chunk_reload'))

export default router
