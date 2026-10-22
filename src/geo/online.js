// 在线 / 离线（/ctrl-mode/online-project-id-list）。在线集合为 null = 未知（接口失败 / 返回空）：一律不判离线。
// 项目 online：true 在线 / false 离线 / 缺省 未知

// 接口响应 → Set(id 字符串)；不是数组或为空 → null
export function toOnlineSet(data) {
  const ids = data?.ids
  if (!Array.isArray(ids) || !ids.length) return null
  return new Set(ids.map(String))
}

export const isOnline = (onlineSet, id) => (onlineSet ? onlineSet.has(String(id)) : null)

export function applyOnline(projects, onlineSet) {
  if (!onlineSet) return projects // online 字段缺省 = 未知
  return projects.map((p) => ({ ...p, online: onlineSet.has(String(p.id)) }))
}

// 一组项目的在线汇总：{ online, offline, total, allOffline, mixed }；未知时 null
export function onlineSummary(projects, onlineSet) {
  if (!onlineSet) return null
  let online = 0
  for (const p of projects) if (onlineSet.has(String(p.id))) online++
  const total = projects.length
  const offline = total - online
  return { online, offline, total, allOffline: total > 0 && offline === total, mixed: online > 0 && offline > 0 }
}

// 小区（groups）汇总：{ known, online, total, groups: { allOffline, mixed, allOnline } }；未知时 null
export function groupsOnlineStats(groups, onlineSet) {
  if (!onlineSet) return null
  const out = { online: 0, total: 0, groups: { allOffline: 0, mixed: 0, allOnline: 0 } }
  for (const g of groups) {
    const s = onlineSummary(g.projects, onlineSet)
    out.online += s.online
    out.total += s.total
    out.groups[s.allOffline ? 'allOffline' : s.mixed ? 'mixed' : 'allOnline']++
  }
  return out
}
