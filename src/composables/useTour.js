// 展厅待机巡览（attract mode）状态机 —— docs/fable-autotour.md
//   idle →（空闲到点 && canStart）→ running(step) →（任意输入 / hidden / 停用）→ idle
//   running 内可被新一级告警插播（interrupt）：已定位 → 飞过去停 15 s 后从 #0 重开；未定位 → 列表闪 + 原步骤暂停 6 s
// 无 DOM / 高德依赖（全部经参数注入），可在 node 下单测；计时器全是 setTimeout，所有异步回调先比对 seq。
import { ref, reactive } from 'vue'

export const IDLE_MS = 120000
export const FLY_MS = 900
export const SETTLE_MS = 100
export const GAP_MS = 300
export const DWELL = { city: 10000, district: 6000, districtOnly: 8000, community: 8000, heat: 8000, interrupt: 15000, interruptUnlocated: 6000 }
export const READING_FACTOR = 5 // 人开着的弹窗 / 下拉：阈值 × 5（600 s）
export const RETRY_MS = 10000 // 到点但前置条件不满足：10 s 后再查
export const MOVE_SLOP = 6 // pointermove 距上次记录点 ≥ 6 px 才算输入（鼠标 / 触框抖动不算）
export const THROTTLE_MS = 10 * 60 * 1000 // 同一小区 10 min 内只插播一次
export const QUEUE_MAX = 3
export const INPUTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']
export const CHIP = { heatProjects: '热力 · 小区内项目数', heatAlarms: '热力 · 一级告警（近 10 天）' }

// ?tour=off|0 / now|1 / <秒>（hash 后的 ? 与 search 都读，同 ?theme）；localStorage.dm_tour='off' 持久禁用、dm_tour_idle（秒）改阈值
const clampSec = (v) => (Number.isFinite(v) && v > 0 ? Math.min(3600, Math.max(30, v)) : 0)
export function tourConfig({ search = '', hash = '', storage = null } = {}) {
  const q = new URLSearchParams((hash.split('?')[1] || '') + '&' + search.replace(/^\?/, ''))
  const p = (q.get('tour') || '').trim().toLowerCase()
  let stored = {}
  try {
    stored = { off: storage?.getItem('dm_tour') === 'off', idle: Number(storage?.getItem('dm_tour_idle')) }
  } catch {
    /* 隐私模式 */
  }
  const enabled = !(p === 'off' || p === '0' || stored.off)
  const now = enabled && (p === 'now' || p === '1')
  const sec = !now && /^\d+$/.test(p) ? clampSec(Number(p)) : 0
  const idleMs = (sec || clampSec(stored.idle) || IDLE_MS / 1000) * 1000
  return { enabled, now, idleMs }
}

/**
 * o.map()            → AmapView 暴露的 { flyCity, flyDistrict, flyCommunity, closePop, popOpenedBy, claimPop } 或 null
 * o.canStart()       → { ok, reading }（reading：人开着弹窗 / 下拉 / 说明 → 阈值 × 5）
 * o.plan()           → { story, city, districts: planTour().districts }（每轮开始时取一次）
 * o.getMode / setMode / getMetric / setMetric、o.setRow({ district, alarmId } | null)
 * o.revealUnlocated(d)、o.showAlarm(id, { flash })、o.closeOverlays()、o.reduced()、o.dip()
 */
export function useTour(o) {
  const now = o.now || (() => performance.now())
  const setT = o.setTimeout || ((f, ms) => setTimeout(f, ms))
  const clearT = o.clearTimeout || ((t) => clearTimeout(t))
  const idleMs = o.idleMs || IDLE_MS
  const enabled = o.enabled !== false
  const visible = o.visible || (() => typeof document === 'undefined' || document.visibilityState === 'visible')

  const state = ref('idle') // 'idle' | 'running'
  const step = ref('') // 'city' | 'district' | 'community' | 'heat' | 'interrupt' | ''
  // 胶囊：两个 span 交叉淡入（a / b，cur 指向显示中的那个）
  const chip = reactive({ show: false, a: '', b: '', cur: 'a', alarm: false })

  let seq = 0
  let lastInputAt = now()
  let lastPt = null
  let idleTimer = 0
  let stepTimer = 0
  let active = true
  let saved = null // 巡览开始时的 { mode, metric }
  let cur = null // 进行中的停留 { end, res, my }
  let holdUntil = 0 // 未定位插播：原步骤暂停到此刻
  let holdTimer = 0
  let held = null // 暂停期间被推迟的 { chip, alarm, row }
  let interrupting = false
  const queue = []
  const shownAt = new Map() // 小区 key → 上次插播时刻
  const ac = typeof AbortController === 'function' ? new AbortController() : null

  const alive = (my) => state.value !== 'idle' && my === seq
  const map = () => o.map?.() || null

  function setChip(text, alarm = false) {
    if (held) {
      held.chip = text
      held.alarm = alarm
      return
    }
    chip.alarm = alarm
    if (chip[chip.cur] === text) return
    const next = chip.cur === 'a' ? 'b' : 'a'
    chip[next] = text
    chip.cur = next
  }
  let rowNow = null
  function setRow(r) {
    if (held) held.row = r
    else {
      rowNow = r
      o.setRow?.(r)
    }
  }

  // ---------- 停留计时（单一 stepTimer；未定位插播可把它整体往后推） ----------
  function armStep() {
    clearT(stepTimer)
    stepTimer = 0
    if (!cur) return
    stepTimer = setT(fireStep, Math.max(0, Math.max(cur.end, holdUntil) - now()))
  }
  function fireStep() {
    stepTimer = 0
    const c = cur
    if (!c || !alive(c.my)) return
    if (now() < holdUntil || now() < c.end) return armStep()
    cur = null
    c.res(true)
  }
  const sleep = (ms, my) =>
    new Promise((res) => {
      if (!alive(my)) return res(false)
      cur = { end: Math.max(now(), holdUntil) + ms, res, my }
      armStep()
    })

  // 相机：减少动态 → 一暗一亮（300 ms）代替镜头移动；飞行由 AmapView 做（它在 reduced 时也是瞬时）
  function camera(fn) {
    const reduced = o.reduced?.()
    if (reduced) o.dip?.()
    return Promise.resolve(fn(reduced ? 0 : FLY_MS)).catch(() => false)
  }
  function setMode(m) {
    if (o.getMode() !== m) o.setMode(m)
  }

  // ---------- 一轮脚本（§2） ----------
  async function stepCity(my, p) {
    step.value = 'city'
    setMode('markers')
    setRow(null)
    setChip(p.city)
    await camera((ms) => map()?.flyCity(ms))
    if (!alive(my)) return
    await sleep(DWELL.city, my)
  }
  async function stepDistrict(my, d) {
    step.value = 'district'
    setRow({ district: d.name, alarmId: null })
    setChip(d.label)
    await camera((ms) => map()?.flyDistrict(d.key, ms))
    if (!alive(my)) return
    if (d.unlocatedOnly) {
      o.revealUnlocated?.({ label: d.name, unlocatedAlarms: d.unlocatedAlarms })
      return sleep(DWELL.districtOnly, my)
    }
    if (!d.community) return sleep(DWELL.districtOnly, my)
    await sleep(DWELL.district, my)
    if (!alive(my)) return
    step.value = 'community'
    setChip(d.communityChip)
    setRow({ district: d.name, alarmId: d.alarmId })
    if (d.alarmId != null) o.showAlarm?.(d.alarmId, { flash: false })
    await camera((ms) => map()?.flyCommunity(d.community, { ms, by: 'tour', alive: () => alive(my) }))
    if (!alive(my)) return
    await sleep(DWELL.community, my)
    if (!alive(my)) return
    map()?.closePop({ onlyIf: 'tour' })
    setRow({ district: d.name, alarmId: null })
    await sleep(GAP_MS, my)
  }
  async function stepHeat(my, p) {
    step.value = 'heat'
    setRow(null)
    await camera((ms) => map()?.flyCity(ms))
    if (!alive(my)) return
    setMode('heat')
    if (o.getMetric() !== 'projects') o.setMetric('projects')
    setChip(CHIP.heatProjects)
    await sleep(DWELL.heat, my)
    if (!alive(my)) return
    if (p.story === 'alarm') {
      o.setMetric('alarms')
      setChip(CHIP.heatAlarms)
      await sleep(DWELL.heat, my)
      if (!alive(my)) return
    }
    setMode('markers')
    await sleep(GAP_MS, my)
  }
  async function loop(my) {
    while (alive(my)) {
      const p = o.plan() // 每轮开始时重新选（轮中数据变化不改当前剧本）
      if (import.meta.env?.DEV) dbg.plan = p
      await stepCity(my, p)
      for (const d of p.districts) {
        if (!alive(my)) return
        await stepDistrict(my, d)
      }
      if (!alive(my)) return
      await stepHeat(my, p)
    }
  }

  // ---------- 开始 / 退出 ----------
  function start() {
    if (!enabled || state.value !== 'idle' || !active || !visible()) return false
    const c = o.canStart()
    if (!c.ok) return false
    clearT(idleTimer)
    idleTimer = 0
    if (c.reading) o.closeOverlays?.() // 600 s 仍无输入：前一个人留下的弹窗 / 下拉收起
    saved = { mode: o.getMode(), metric: o.getMetric() }
    state.value = 'running'
    const my = ++seq
    queue.length = 0
    interrupting = false
    chip.alarm = false
    chip.show = true
    loop(my)
    return true
  }
  // 同步执行（在捕获阶段的输入监听里）：≤ 100 ms 内胶囊淡出、不再有任何视野变化
  function stop(reason = 'input', ev = null) {
    if (state.value === 'idle') return false
    state.value = 'idle'
    seq++
    clearT(stepTimer)
    clearT(holdTimer)
    stepTimer = holdTimer = 0
    cur = null
    holdUntil = 0
    held = null
    interrupting = false
    queue.length = 0
    step.value = ''
    chip.show = false
    rowNow = null
    o.setRow?.(null)
    const m = map()
    if (m) {
      const t = ev && ev.target
      if (t && t.closest && t.closest('.dm-pop')) m.claimPop?.() // 他就是来读这个弹窗的
      else m.closePop?.({ onlyIf: 'tour' })
    }
    // 只恢复巡览改过的（pointerdown 先于 click：他若正点着分段按钮，click 随后设成他要的值）
    if (saved) {
      if (o.getMode() !== saved.mode) o.setMode(saved.mode)
      if (o.getMetric() !== saved.metric) o.setMetric(saved.metric)
    }
    saved = null
    if (import.meta.env?.DEV) dbg.lastStop = reason
    // 不恢复视野：进行中的飞行不急停、不发新相机指令
    return true
  }

  // ---------- 空闲判定（§1.1）：输入只写时间戳；一个 setTimeout 到点检查，不够按差值再排 ----------
  function armIdle(ms) {
    clearT(idleTimer)
    idleTimer = enabled && active ? setT(checkIdle, Math.max(0, ms)) : 0
  }
  function checkIdle() {
    idleTimer = 0
    if (!enabled || !active || !visible() || state.value !== 'idle') return
    const c = o.canStart()
    const th = c.reading ? idleMs * READING_FACTOR : idleMs
    const el = now() - lastInputAt
    if (el < th) return armIdle(th - el)
    if (!c.ok) return armIdle(RETRY_MS)
    start()
  }
  function onInput(e) {
    if (e.type === 'pointermove') {
      const p = [e.clientX, e.clientY]
      const first = !lastPt
      if (!first && Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1]) < MOVE_SLOP) return
      lastPt = p
      if (first) return // 第一次只记点（地图动画下浏览器补发的同坐标 move 不能算）
    } else if (e.clientX != null) lastPt = [e.clientX, e.clientY]
    lastInputAt = now()
    if (state.value !== 'idle') {
      stop('input', e)
      armIdle(idleMs)
    }
  }
  function onVisibility() {
    if (visible()) {
      lastInputAt = now()
      armIdle(idleMs)
    } else {
      stop('hidden')
      clearT(idleTimer)
      idleTimer = 0
    }
  }
  // keep-alive：详情页 = hidden
  function setActive(v) {
    active = v
    if (v) {
      lastInputAt = now()
      armIdle(idleMs)
    } else {
      stop('inactive')
      clearT(idleTimer)
      idleTimer = 0
    }
  }

  // ---------- 新一级告警插播（§5.4） ----------
  // a = { key, located, district, alarmId, chip }；返回 true = 巡览接手了（调用方不再做非巡览的提示）
  function interrupt(a) {
    if (state.value === 'idle') return false
    const t = now()
    if (a.key && shownAt.has(a.key) && t - shownAt.get(a.key) < THROTTLE_MS) return true
    if (interrupting || held) {
      queue.push(a)
      if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX) // 溢出只留最新
      return true
    }
    if (a.key) shownAt.set(a.key, t)
    if (!a.located) {
      holdUnlocated(a)
      return true
    }
    const my = ++seq // 打断当前步骤（排队中的异步回调靠 seq 作废）
    clearT(stepTimer)
    cur = null
    interrupting = true
    setT(() => alive(my) && runInterrupt(my, a), 0) // 下一宏任务
    return true
  }
  async function runInterrupt(my, a) {
    step.value = 'interrupt'
    map()?.closePop({ onlyIf: 'tour' })
    setMode('markers')
    setChip(a.chip, true)
    setRow({ district: a.district || null, alarmId: a.alarmId })
    o.showAlarm?.(a.alarmId, { flash: true })
    await camera((ms) => map()?.flyCommunity(a.key, { ms, by: 'tour', alive: () => alive(my) }))
    if (!alive(my)) return
    await sleep(DWELL.interrupt, my)
    if (!alive(my)) return
    map()?.closePop({ onlyIf: 'tour' })
    const next = queue.shift()
    if (next) {
      interrupting = false
      if (next.key) shownAt.set(next.key, now())
      if (!next.located) {
        holdUnlocated(next)
        return loop(my)
      }
      interrupting = true
      return runInterrupt(my, next)
    }
    interrupting = false
    chip.alarm = false
    loop(my) // 回 #0 重新开一轮（不接回被打断的步骤）
  }
  // 未定位：不动镜头；列表滚到那条 + 闪，停 6 s 后继续原步骤剩余时间
  function holdUnlocated(a) {
    const prev = { chip: chip[chip.cur], alarm: chip.alarm, row: rowNow }
    setChip(a.chip, true)
    setRow({ district: a.district || null, alarmId: a.alarmId })
    o.showAlarm?.(a.alarmId, { flash: true })
    held = prev // 暂停期间脚本写的胶囊 / 高亮先记在这里，6 s 后生效
    const t = now()
    holdUntil = t + DWELL.interruptUnlocated
    if (cur) {
      cur.end += DWELL.interruptUnlocated
      armStep()
    }
    clearT(holdTimer)
    holdTimer = setT(() => {
      holdTimer = 0
      if (state.value === 'idle') return
      const h = held
      held = null
      if (!h) return
      setChip(h.chip, h.alarm)
      setRow(h.row)
      const next = queue.shift()
      if (next) interrupt(next)
    }, DWELL.interruptUnlocated)
  }

  // ---------- 监听 ----------
  const target = o.target === undefined ? (typeof window !== 'undefined' ? window : null) : o.target
  const doc = o.doc === undefined ? (typeof document !== 'undefined' ? document : null) : o.doc
  if (enabled && target) {
    const opt = { capture: true, passive: true, ...(ac ? { signal: ac.signal } : {}) }
    for (const t of INPUTS) target.addEventListener(t, onInput, opt)
    if (doc) doc.addEventListener('visibilitychange', onVisibility, ac ? { signal: ac.signal } : undefined)
  }
  if (enabled) armIdle(idleMs)

  function dispose() {
    stop('dispose')
    clearT(idleTimer)
    idleTimer = 0
    ac?.abort()
  }

  const dbg = { plan: null, lastStop: '' }
  return {
    state,
    step,
    chip,
    start,
    stop,
    interrupt,
    setActive,
    dispose,
    onInput, // 测试 / 无 window 时直接喂事件
    debug: () => ({ ...dbg, seq, idleArmed: Boolean(idleTimer), lastInputAt, queue: queue.length, holdUntil }),
  }
}
