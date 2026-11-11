// 定位结果的生命周期（纯函数）：
//   已确认：POS_TTL 后按本地 / 种子 / 共享重新核对一次（不发高德请求），位置只在确有不同时才变
//   未确认：FAIL_TTL 后重新核对（别的设备补了坐标、候选变了，这里才能感知）
//   临时失败：按次数退避重试（5 分钟 → 15 分钟 → 1 小时 → 封顶 6 小时）
export const POS_TTL = 6 * 3600 * 1000
export const FAIL_TTL = 30 * 60 * 1000
const RETRY_BASE = 5 * 60 * 1000
const RETRY_MAX = 6 * 3600 * 1000
export const retryBackoff = (attempts) => Math.min(RETRY_MAX, RETRY_BASE * 3 ** Math.max(0, attempts - 1))

export function stamp(res, { now = Date.now(), attempts = 1 } = {}) {
  const exp = res.lnglat ? now + POS_TTL : res.transient ? now + retryBackoff(attempts) : now + FAIL_TTL
  return { ...res, exp }
}
export const expired = (r, now = Date.now()) => r?.exp != null && now >= r.exp
export const samePos = (a, b) => Boolean(a && b) && a[0] === b[0] && a[1] === b[1]

// 每轮额度：allow(key) 同一 key 反复问算一次；reset() 开始新一轮
export function createRetryBudget(limit) {
  const used = new Set()
  return {
    allow: (key) => {
      if (used.has(key)) return true
      if (used.size >= limit) return false
      used.add(key)
      return true
    },
    reset: () => used.clear(),
    get size() {
      return used.size
    },
  }
}

// 按项目 id 比对新旧元数据：只有影响定位的字段变了才算 changed
const GEO_FIELDS = ['community', 'geoDistrict', 'city', 'queries', 'keywords']
const geoSig = (p) => JSON.stringify(GEO_FIELDS.map((k) => p[k]))
export const groupKeyOf = (p) => (p.community ? `${p.geoDistrict || p.city}|${p.community}` : `#${p.id}`)

// 返回 { list, invalidKeys, changed }：完全没变时 list === prev（不触发重算）；
// 内容未变的项目沿用旧对象，只有定位相关字段变了才把新旧分组 key 列入 invalidKeys
export function syncProjects(prev, next) {
  const old = new Map(prev.map((p) => [p.id, p]))
  const invalid = new Set()
  let same = prev.length === next.length
  const list = next.map((p, i) => {
    const o = old.get(p.id)
    if (o && JSON.stringify(o) === JSON.stringify(p)) {
      if (prev[i] !== o) same = false
      return o
    }
    same = false
    if (!o) invalid.add(groupKeyOf(p))
    else if (geoSig(o) !== geoSig(p)) {
      invalid.add(groupKeyOf(o))
      invalid.add(groupKeyOf(p))
    }
    return p
  })
  return { list: same ? prev : list, invalidKeys: [...invalid], changed: !same }
}
