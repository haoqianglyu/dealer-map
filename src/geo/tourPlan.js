// 展厅待机巡览的内容选取（docs/fable-autotour.md §3）：纯函数，无 DOM / 高德依赖，可单测。
import { alarmCount, isActiveAlarm } from './states.js'
import { fmtNumber } from '../utils/format.js'

const MAX_DISTRICTS = 3
// 进行中一级告警（与标记角标同口径：states.alarmCount）
const activeL1 = (projects) => projects.flatMap((p) => (p.alarms || []).filter((a) => a.level === 1 && isActiveAlarm(a)))
const latestTs = (list) => list.reduce((m, a) => Math.max(m, a.ts || 0), 0)
// 「1.2 万㎡」：胶囊里一位小数就够
export const shortArea = (v) => (v >= 10000 ? `${(v / 10000).toFixed(1)} 万㎡` : `${fmtNumber(Math.round(v))} ㎡`)
const areaOf = (projects) => projects.reduce((s, p) => s + (Number(p.area) || 0), 0)
// 「#id」单项目组（未识别小区）不选
// 离线小区不选（§3.4）：全部项目确认离线且无告警 / 预警
const offlineOnly = (ps) => ps.length > 0 && ps.every((p) => p.online === false && p.state !== 'alarm' && p.state !== 'warning')
const selectable = (c) => c && c.lnglat && !String(c.key).startsWith('#') && !offlineOnly(c.projects || [])

/**
 * @returns {{ story: 'alarm' | 'scale', districts: Array<{ key, label, name, projects, alarms, hasAlarm, unlocatedOnly, unlocatedAlarms,
 *   community: string | null, communityLabel, communityChip, alarmId }> }}
 */
export function planTour({ districts = [], communities = [], cityCode = '', alarmsUsable = false, sameCity = defaultSameCity } = {}) {
  const cands = districts.filter((d) => d && d.lnglat && sameCity(d.key, cityCode))
  const withAlarm = alarmsUsable ? cands.filter((d) => alarmCount(d.projects) > 0) : []
  const story = withAlarm.length ? 'alarm' : 'scale'
  const byProjects = (a, b) => b.projects.length - a.projects.length || String(a.key).localeCompare(String(b.key))
  let picked
  if (story === 'alarm') {
    picked = [...withAlarm].sort((a, b) => alarmCount(b.projects) - alarmCount(a.projects) || byProjects(a, b)).slice(0, MAX_DISTRICTS)
    if (picked.length < MAX_DISTRICTS) picked.push(...cands.filter((d) => !picked.includes(d)).sort(byProjects).slice(0, MAX_DISTRICTS - picked.length))
  } else {
    picked = [...cands].sort(byProjects).slice(0, MAX_DISTRICTS)
  }
  const used = new Set() // 一轮内同一小区只出现一次
  const out = picked.map((d) => {
    const alarms = story === 'alarm' ? alarmCount(d.projects) : 0
    const own = communities.filter((c) => selectable(c) && c.district === d.key && !used.has(c.key))
    let focus = null
    if (story === 'alarm') {
      const scored = own.map((c) => {
        const act = activeL1(c.projects)
        return { c, n: alarmCount(c.projects), ts: latestTs(act), act }
      })
      scored.sort((a, b) => b.n - a.n || b.ts - a.ts || b.c.projects.length - a.c.projects.length || String(a.c.key).localeCompare(String(b.c.key)))
      const best = scored[0]
      // 有告警但全部在未定位小区：只走列表（不飞到兜底坐标）
      if (alarms > 0 && (!best || best.n === 0)) focus = null
      else if (best) focus = best
    } else {
      const s = [...own].sort((a, b) => b.projects.length - a.projects.length || areaOf(b.projects) - areaOf(a.projects) || String(a.key).localeCompare(String(b.key)))
      if (s[0]) focus = { c: s[0], n: 0, act: [] }
    }
    if (focus) used.add(focus.c.key)
    const unlocatedOnly = story === 'alarm' && alarms > 0 && !focus
    const n = d.projects.length
    let label = `${d.label} · ${fmtNumber(n)} 个项目`
    if (story === 'alarm') label += alarms ? ` · ${fmtNumber(alarms)} 条进行中告警` : ' · 无进行中告警'
    let communityChip = ''
    let alarmId = null
    if (focus) {
      const c = focus.c
      if (focus.n > 0) {
        communityChip = `${c.label} · ${fmtNumber(focus.n)} 条进行中告警`
        const top = [...focus.act].sort((a, b) => b.ts - a.ts)[0]
        alarmId = top ? top.id : null
      } else {
        const area = areaOf(c.projects)
        communityChip = `${c.label} · ${fmtNumber(c.projects.length)} 个项目${area ? ` · ${shortArea(area)}` : ''}`
      }
    }
    return {
      key: d.key,
      name: d.label,
      label,
      projects: n,
      alarms,
      hasAlarm: alarms > 0,
      unlocatedOnly,
      unlocatedAlarms: alarmCount(d.unlocatedProjects || []),
      community: focus ? focus.c.key : null,
      communityLabel: focus ? focus.c.label : '',
      communityChip,
      alarmId,
    }
  })
  return { story, districts: out }
}

export function defaultSameCity(district, city) {
  return Boolean(district && city && String(district).slice(0, 4) === String(city).slice(0, 4))
}

// 城市步骤的胶囊文字（#0）
export function cityChip({ story, cityName, projects, communities, activeAlarms }) {
  const head = `${cityName || '全市'} · ${fmtNumber(projects)} 个项目`
  return story === 'alarm' ? `${head} · 进行中告警 ${fmtNumber(activeAlarms)}` : `${head} · ${fmtNumber(communities)} 个小区`
}

/**
 * 新一级告警判定（§5.4，与第 5 条 toast 共用）：id 未见过、进行中、一级、ts > 上次轮询时刻 − 5 min。
 * 调用方负责「首轮不算」与 alarmsUsable。返回按 ts 降序。
 */
export const FRESH_SLACK_MS = 5 * 60 * 1000
export function newAlarms(alarms, seen, lastPollAt) {
  const since = (lastPollAt || 0) - FRESH_SLACK_MS
  return alarms.filter((a) => !seen.has(a.id) && a.level === 1 && isActiveAlarm(a) && a.ts > since).sort((a, b) => b.ts - a.ts)
}
