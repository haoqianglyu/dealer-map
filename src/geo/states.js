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

// 告警接入前：所有项目为 normal。将来在这里按 bigscreen_fable 的 getAlarmList
// （POST /ctrl/get-alarm-list → entities[{ level: 1|2, timestamp, ... }]）按项目汇总后写入 state/alarmCount/newAlarm。
export function applyStates(projects, stateById = null) {
  return projects.map((p) => {
    const s = stateById?.get(p.id)
    return s ? { ...p, ...s } : p
  })
}

// 仅开发用：按项目 id 生成确定性的假状态，便于截图检查样式
export function fakeStates(projects) {
  const m = new Map()
  for (const p of projects) {
    let h = 0
    for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const r = h % 20
    const state = r < 3 ? 'alarm' : r < 6 ? 'warning' : r < 8 ? 'offline' : 'normal'
    m.set(p.id, { state, alarmCount: state === 'alarm' ? 1 + (h % 3) : 0, newAlarm: state === 'alarm' && h % 2 === 0 })
  }
  return m
}
