// 「只要最新的」令牌：快速切换时，旧请求的响应不写状态。
export function createLatest() {
  let cur = 0
  let ctl = null
  return {
    begin() {
      ctl?.abort()
      ctl = typeof AbortController === 'function' ? new AbortController() : null
      const my = ++cur
      return { my, signal: ctl?.signal, stale: () => my !== cur }
    },
  }
}
