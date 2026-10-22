// 在线 / 离线（/ctrl-mode/online-project-id-list），docs/fable-offline.md。
// 项目字段（不走 states.js 的 worstState：那里 offline 排在 normal 之上，一户离线就会整片变灰）：
//   online：true 在线 / false 离线 / null 未知 —— 弹窗行点即时用它（实心灰 = 离线，空心灰圈 = 未知）
//   offline：标记用的「确认离线」= 连续 2 次成功轮询都不在在线列表里（防 60 s 一次的闪色）
// 未知（null）：接口失败且上次成功已超过 5 分钟 / 返回空（ids: []）/ 与当前项目一个都对不上——一律不判离线，永不全灰。

export const STALE_MS = 5 * 60 * 1000

// 接口响应 → Set(id 字符串)；不是数组或为空 → null（当失败处理）
export function toOnlineSet(data) {
  const ids = data?.ids
  if (!Array.isArray(ids) || !ids.length) return null
  return new Set(ids.map(String))
}

export const isOnline = (onlineSet, id) => (onlineSet ? onlineSet.has(String(id)) : null)

// 轮询结果 → 视图状态。每次轮询调用 update(set | null)（null = 失败 / 空）。
// view = { cur, prev, stale, updatedAt } | null：
//   cur：最近一次成功的在线集合；prev：再上一次成功的（null = 还只有一次）
//   stale：本次失败、沿用上一次（≤ 5 分钟）；超过 5 分钟 → view = null（未知）
export function createOnlineTracker({ now = () => Date.now() } = {}) {
  let cur = null
  let prev = null
  let okAt = 0
  let view = null
  return {
    update(set) {
      const t = now()
      if (set) {
        prev = cur
        cur = set
        okAt = t
        view = { cur, prev, stale: false, updatedAt: t }
      } else if (cur && t - okAt <= STALE_MS) {
        view = { cur, prev, stale: true, updatedAt: okAt }
      } else {
        cur = prev = null
        view = null
      }
      return view
    },
    get view() {
      return view
    },
  }
}

// 当前项目一个都不在在线列表里：多半是接口 / 账号对不上，不是真全离线 → 当未知（永不全灰）
export function sane(view, projects) {
  if (!view || !projects.length) return view
  return projects.some((p) => view.cur.has(String(p.id))) ? view : null
}

export function applyOnline(projects, view) {
  if (!view) return projects.map((p) => ({ ...p, online: null, offline: false }))
  const { cur, prev } = view
  return projects.map((p) => {
    const id = String(p.id)
    const online = cur.has(id)
    return { ...p, online, offline: !online && Boolean(prev) && !prev.has(id) }
  })
}

// 标记变灰：没有告警 / 预警，且每个项目都「确认离线」（任何级别：小区、簇、区县同一规则）
export const allOffline = (projects) => projects.length > 0 && projects.every((p) => p.offline && p.state !== 'alarm' && p.state !== 'warning')
// 弹窗头「N 户离线」：按即时状态
export const offlineCount = (projects) => projects.reduce((n, p) => n + (p.online === false ? 1 : 0), 0)

// 一组项目的在线汇总：{ online, offline, total, allOffline, mixed }；未知时 null
export function onlineSummary(projects, view) {
  if (!view) return null
  const set = view.cur || view
  let online = 0
  for (const p of projects) if (set.has(String(p.id))) online++
  const total = projects.length
  const offline = total - online
  return { online, offline, total, allOffline: total > 0 && offline === total, mixed: online > 0 && offline > 0 }
}

// 小区（groups）汇总：{ online, total, groups: { allOffline, mixed, allOnline } }；未知时 null
export function groupsOnlineStats(groups, view) {
  if (!view) return null
  const out = { online: 0, total: 0, groups: { allOffline: 0, mixed: 0, allOnline: 0 } }
  for (const g of groups) {
    const s = onlineSummary(g.projects, view)
    out.online += s.online
    out.total += s.total
    out.groups[s.allOffline ? 'allOffline' : s.mixed ? 'mixed' : 'allOnline']++
  }
  return out
}
