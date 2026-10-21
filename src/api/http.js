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

// 回登录页并整页重载：清掉 keep-alive 的地图页实例与内存里的账号数据（换账号登录不会看到上一个账号的视图）
export function toLogin(reason = '') {
  session.clear()
  if (reason) sessionStorage.setItem('dm_login_reason', reason)
  if (!location.hash.startsWith('#/login')) location.hash = '#/login'
  location.reload()
}

// 会话失效：401；平台对无效/过期 token 的 /me 返回 403（其它接口的 403 是无权限，不算失效）
const sessionInvalid = (err) => {
  const st = err.response?.status
  return st === 401 || (st === 403 && /^\/?me$/.test(err.config?.url || ''))
}

// 接口错误 → 中文提示（不把英文原文 / 状态码甩给用户）
export function errorText(e, fallback = '请求失败，请稍后重试') {
  const st = e?.response?.status
  const msg = e?.response?.data?.message
  if (msg && /[\u4e00-\u9fa5]/.test(msg)) return msg
  if (e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')) return '服务器响应超时，请稍后重试'
  if (!e?.response) return '网络连接失败，请检查网络后重试'
  if (st >= 500) return '服务器暂时不可用，请稍后重试'
  if (st === 403) return '当前账号无权限'
  return fallback
}

// 401（或 /me 的 403）：先尝试用 refresh_token 续期一次，失败则回登录页
http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config || {}
    if (sessionInvalid(err) && !cfg.skipAuth && !cfg._retried) {
      try {
        await refreshSession()
        return http({ ...cfg, _retried: true })
      } catch {
        toLogin('登录已过期，请重新登录')
        return new Promise(() => {}) // 页面即将重载：不再把错误抛给界面（避免闪出英文错误）
      }
    }
    return Promise.reject(err)
  }
)

export default http
