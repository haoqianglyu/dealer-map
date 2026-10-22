import axios from 'axios'
import { session } from './session.js'

// /api 前缀经 vite 代理到平台 /v1；所有请求都带当前登录用户的 token，
// 数据范围完全由后端按账号权限过滤（经销商账号只能看到自己的项目）。
const http = axios.create({ baseURL: '/api', timeout: 60000 })

http.interceptors.request.use((config) => {
  const token = session.token()
  if (token && !config.skipAuth) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 续期：平台 POST /v1/auth/refresh { refresh_token }，必须同时带 Authorization: Bearer <access_token>（不带 → 401 no token），
// 返回 { access_token, refresh_token, expires_in }。refresh_token 一次性（用过即作废），且每个账号只有最新一次登录的有效
// （同账号在别处登录后，这里的就续不了，到期回登录页）。所以：
//  · 本页 single-flight（主动续期、多个并发 401/403 共用同一次）；
//  · 跨标签页用 Web Locks 串行，拿到锁后若 token 已被别的标签页换过就直接用新的，不再拿旧 refresh_token 去换。
let refreshing = null
const withLock = (fn) => (globalThis.navigator?.locks ? navigator.locks.request('dm-token-refresh', fn) : fn())
export function refreshSession({ ifToken } = {}) {
  if (!refreshing) {
    const seen = ifToken ?? session.token()
    refreshing = withLock(async () => {
      if (session.token() && session.token() !== seen) return // 别的标签页刚续过
      const refresh_token = session.refreshToken()
      if (!refresh_token) throw new Error('no refresh token')
      const r = await http.post('/auth/refresh', { refresh_token }, { skipAuth: true, headers: { Authorization: `Bearer ${session.token()}` } })
      if (!r.data?.access_token) throw new Error('refresh: no access_token')
      // 续期期间已退出 / 换了账号登录：丢弃，不把旧会话写回去
      if (session.refreshToken() !== refresh_token) return
      session.save(r.data)
    }).finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

// 回登录页并整页重载：清掉 keep-alive 的地图页实例与内存里的账号数据（换账号登录不会看到上一个账号的视图）
// tone：'warn'（会话过期等，警示色）| 'info'（主动退出，灰字）
export function toLogin(reason = '', tone = 'warn') {
  session.clear()
  if (reason) sessionStorage.setItem('dm_login_reason', JSON.stringify({ text: reason, tone }))
  if (!location.hash.startsWith('#/login')) location.hash = '#/login'
  location.reload()
}

// 可能是会话失效：401，或任何接口的 403——平台对过期 token 在多数接口上返回 403（不是 401），
// 只有续期后重试仍 403 才算真的无权限。我们自己 Worker 拒绝的（不在白名单的 message_type）不算。
const maybeExpired = (err) => {
  const st = err.response?.status
  if (st === 401) return true
  return st === 403 && !(err.response?.data && err.response.data.error === 'message_type not allowed')
}
// 续期后重试仍 403 的接口：同一个 token 下不再为它续期（例如账号确实没有告警权限时，每分钟轮询不应每次都换 token）
const forbidden = new Map() // url → token
const keyOf = (cfg) => `${(cfg.method || 'get').toUpperCase()} ${cfg.url}`

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

// 401 / 403：续期一次后重试；续期失败 → 回登录页（登录已过期）；重试仍 403 → 交给页面显示「无权限」
http.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config || {}
    if (!maybeExpired(err) || cfg.skipAuth) return Promise.reject(err)
    const sent = (cfg.headers?.Authorization || cfg.headers?.authorization || '').replace(/^Bearer /, '')
    if (cfg._retried) {
      if (err.response.status === 403 && sent) forbidden.set(keyOf(cfg), sent)
      return Promise.reject(err)
    }
    if (err.response.status === 403 && sent && forbidden.get(keyOf(cfg)) === sent) return Promise.reject(err)
    try {
      // 发请求后 token 已被换过（主动续期 / 别的标签页）：直接用新 token 重试
      if (!sent || sent === session.token()) await refreshSession({ ifToken: sent || session.token() })
    } catch {
      toLogin('登录已过期，请重新登录')
      return new Promise(() => {}) // 页面即将重载：不再把错误抛给界面（避免闪出英文错误）
    }
    return http({ ...cfg, _retried: true })
  }
)

export default http
