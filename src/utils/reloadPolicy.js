// 电视长期不刷新的兜底策略（纯函数）。

// index.html 里的入口文件名（带内容哈希）；开发环境没有，返回 ''
export const entryOf = (html) => (String(html || '').match(/\/assets\/index-[\w-]+\.js/) || [''])[0]
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// 每天固定时段（默认 4 点这一小时）内，今天还没重载过才重载；错过这一小时就等明天
export const shouldDailyReload = (date, lastDay, hour = 4) => date.getHours() === hour && lastDay !== ymd(date)

// 连续错误计数：windowMs 内累计到 limit 次才算要恢复（偶发错误不重载）
export function createErrorCounter({ limit, windowMs, now = () => Date.now() }) {
  let hits = []
  return {
    hit() {
      const t = now()
      hits = hits.filter((x) => t - x < windowMs)
      hits.push(t)
      return hits.length >= limit
    },
  }
}

// 防重载死循环：窗口内最多重载 maxReloads 次，超过就停下等人处理
export const RECOVER_WINDOW = 30 * 60 * 1000
export const RECOVER_MAX = 3
export function recoverAllowed(history, now = Date.now(), { windowMs = RECOVER_WINDOW, max = RECOVER_MAX } = {}) {
  const recent = (history || []).filter((t) => now - t < windowMs)
  return { allowed: recent.length < max, history: recent }
}

// 噪声不算错误：网络类（有自己的重试和错误态）、取消、跨域脚本（高德 SDK 报错浏览器只给 Script error）、ResizeObserver、部署后旧 chunk（路由层已处理）
export function isNoise(err, { message = '', filename = '' } = {}) {
  const m = String(message || err?.message || '')
  if (err?.isAxiosError || ['AbortError', 'TimeoutError', 'CanceledError'].includes(err?.name)) return true
  if (/Script error|ResizeObserver|Network Error|Failed to fetch|Load failed|dynamically imported module|Importing a module script failed/.test(m)) return true
  if (filename && !/^(https?:\/\/(localhost|127\.0\.0\.1|.*dealermap)|\/)/.test(filename)) return true
  return false
}
