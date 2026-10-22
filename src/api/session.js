// 会话：token 存 localStorage（大屏长期挂着：关浏览器 / 重启后仍保持登录，直到点「退出」），不落盘账号密码。
// 退出（session.clear）是唯一清除会话的地方；token 过期由主动续期 + 401/403 被动续期处理。
// sid：每次登录新生成、续期不变——别的标签页据此区分「续期」与「退出 / 换账号登录」
const KEYS = { token: 'dm_token', refresh: 'dm_refresh_token', time: 'dm_token_time', exp: 'dm_token_exp', sid: 'dm_sid' }
const store = () => globalThis.localStorage
const DEFAULT_LIFE = 2 * 60 * 60 // 平台 access_token 有效期 7200 s（登录 / 续期响应的 expires_in）

// 旧版本存在 sessionStorage：搬到 localStorage（已打开的标签页升级后不掉线）
try {
  const ss = globalThis.sessionStorage
  if (ss && !store().getItem(KEYS.token) && ss.getItem(KEYS.token)) {
    Object.values(KEYS).forEach((k) => ss.getItem(k) != null && store().setItem(k, ss.getItem(k)))
  }
  if (ss) Object.values(KEYS).forEach((k) => ss.removeItem(k))
  if (store().getItem(KEYS.token) && !store().getItem(KEYS.sid)) store().setItem(KEYS.sid, `m${Date.now().toString(36)}`)
} catch {
  /* 无 sessionStorage（测试环境） */
}

const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())

// 有效期：以本机收到响应的时刻 + expires_in 计（不依赖本机时钟与服务器一致）；没有 expires_in 时用 JWT 的 exp − iat
function lifeOf({ access_token, expires_in }) {
  if (import.meta.env?.DEV) {
    const dev = Number(store().getItem('dmTokenLife')) // 开发：localStorage.dmTokenLife = 120 → 按 120 s 有效期调度续期
    if (dev > 0) return dev
  }
  if (Number(expires_in) > 0) return Number(expires_in)
  try {
    const p = JSON.parse(atob(access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (p.exp && p.iat && p.exp > p.iat) return p.exp - p.iat
  } catch {
    /* 非 JWT */
  }
  return DEFAULT_LIFE
}

export const session = {
  token: () => store().getItem(KEYS.token),
  refreshToken: () => store().getItem(KEYS.refresh),
  tokenTime: () => Number(store().getItem(KEYS.time)) || 0,
  // 过期时刻（ms）；旧会话没有记录时按 token_time + 2 h 估算
  expiresAt() {
    const e = Number(store().getItem(KEYS.exp))
    if (e) return e
    const t = session.tokenTime()
    return t ? t + DEFAULT_LIFE * 1000 : 0
  },
  sid: () => store().getItem(KEYS.sid),
  // newLogin：登录页调用（新会话）；续期不传
  save(data, { newLogin = false } = {}) {
    const now = Date.now()
    if (newLogin || !store().getItem(KEYS.sid)) store().setItem(KEYS.sid, `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    store().setItem(KEYS.token, data.access_token)
    if (data.refresh_token) store().setItem(KEYS.refresh, data.refresh_token)
    store().setItem(KEYS.time, String(now))
    store().setItem(KEYS.exp, String(now + lifeOf(data) * 1000))
    emit()
  },
  clear() {
    Object.values(KEYS).forEach((k) => store().removeItem(k))
    emit()
  },
  // 本标签页 save / clear 时回调（其它标签页的改动走 window 'storage' 事件）
  onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  KEYS,
}
