// 项目运行状态（为后续接入告警预留）：normal / offline / warning / alarm
// 小区/区县标记的颜色 = 其下项目的「最严重」状态；告警数显示为红色角标。
export const STATES = {
  alarm: { label: '告警', color: '#ff4d4f', rank: 3 },
  warning: { label: '预警', color: '#ffc722', rank: 2 },
  offline: { label: '离线', color: '#8a9bb3', rank: 1 },
  normal: { label: '正常', color: '#00d4ff', rank: 0 },
}

export const stateRank = (s) => STATES[s]?.rank ?? 0

export function worstState(projects) {
  let worst = 'normal'
  for (const p of projects) if (stateRank(p.state) > stateRank(worst)) worst = p.state
  return worst
}

export const alarmCount = (projects) => projects.reduce((s, p) => s + (p.state === 'alarm' ? p.alarmCount || 1 : 0), 0)
export const hasNewAlarm = (projects) => projects.some((p) => p.state === 'alarm' && p.newAlarm)

// 告警等级 → 状态：1 = alarm（红）、2 = warning（黄）、≥3 = notice（只在弹窗里计数，不改变标记颜色）
export const levelState = (level) => (level === 1 ? 'alarm' : level === 2 ? 'warning' : 'notice')
export const NOTICE_COLOR = '#5b8ff9'
// 告警状态（平台）：status 1 未处理、2 处理中、3 已处理；end_timestamp 有值 = 故障已恢复。
// 进行中 = 未处理或处理中（status 1 / 2）且未恢复；只有进行中的告警决定标记颜色
export const isActiveAlarm = (a) => (a.status === 1 || a.status === 2) && !a.end
// 行尾标签：已恢复 > 已处理 > 处理中（仍是进行中、仍标红）；未处理不加标签
export const alarmTag = (a) => (a.end ? '已恢复' : a.status === 3 ? '已处理' : a.status === 2 ? '处理中' : '')
const NEW_MS = 60 * 60 * 1000 // 1 小时内的进行中一级告警：标记闪烁

// alarms（listAlarms 结果）→ Map(projectId → { state, alarmCount, newAlarm, alarms })
export function alarmStates(alarms) {
  const m = new Map()
  const now = Date.now()
  for (const a of alarms) {
    const o = m.get(a.projectId) || { state: 'normal', alarmCount: 0, newAlarm: false, alarms: [] }
    o.alarms.push(a)
    if (isActiveAlarm(a)) {
      const st = levelState(a.level)
      if (st !== 'notice' && stateRank(st) > stateRank(o.state)) o.state = st
      if (a.level === 1) {
        o.alarmCount++
        if (now - a.ts < NEW_MS) o.newAlarm = true
      }
    }
    m.set(a.projectId, o)
  }
  for (const o of m.values()) o.alarms.sort((x, y) => y.ts - x.ts)
  return m
}

export function applyStates(projects, stateById = null) {
  return projects.map((p) => {
    const s = stateById?.get(p.id)
    return s ? { ...p, ...s } : p
  })
}
