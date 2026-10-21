// 会话：token 只存 sessionStorage（关闭标签即失效），不落盘账号密码
const KEYS = { token: 'dm_token', refresh: 'dm_refresh_token', time: 'dm_token_time' }
const ss = window.sessionStorage

export const session = {
  token: () => ss.getItem(KEYS.token),
  refreshToken: () => ss.getItem(KEYS.refresh),
  tokenTime: () => Number(ss.getItem(KEYS.time)) || 0,
  save({ access_token, refresh_token }) {
    ss.setItem(KEYS.token, access_token)
    if (refresh_token) ss.setItem(KEYS.refresh, refresh_token)
    ss.setItem(KEYS.time, String(Date.now()))
  },
  clear() {
    Object.values(KEYS).forEach((k) => ss.removeItem(k))
  },
}
