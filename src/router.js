import { createRouter, createWebHashHistory } from 'vue-router'
import { session } from '@/api/session'

const routes = [
  { path: '/', redirect: '/dealer-map' },
  { path: '/login', component: () => import('@/views/Login.vue') },
  { path: '/dealer-map', component: () => import('@/views/DealerMap.vue') },
]

const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach((to) => {
  if (to.path === '/login') return true
  if (!session.token()) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})

export default router
