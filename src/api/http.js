import axios from 'axios'
import { session } from './session'

// /api 前缀经 vite 代理到平台 /v1；所有请求都带当前登录用户的 token，
// 数据范围完全由后端按账号权限过滤（经销商账号只能看到自己的项目）。
const http = axios.create({ baseURL: '/api', timeout: 60000 })

http.interceptors.request.use((config) => {
  const token = session.token()
  if (token && !config.skipAuth) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshing = null
export function refreshSession() {
  if (!refreshing) {
    const refresh_token = session.refreshToken()
    refreshing = (refresh_token
      ? http.post('/auth/refresh', { refresh_token }, { skipAuth: true }).then((r) => session.save(r.data))
      : Promise.reject(new Error('no refresh token'))
    ).finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

function toLogin() {
  session.clear()
  if (!location.hash.startsWith('#/login')) location.hash = '#/login'
}

// 401：先尝试用 refresh_token 续期一次，失败则回登录页
http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config || {}
    if (err.response?.status === 401 && !cfg.skipAuth && !cfg._retried) {
      try {
        await refreshSession()
        return http({ ...cfg, _retried: true })
      } catch {
        toLogin()
      }
    }
    return Promise.reject(err)
  }
)

export default http
