import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useTour, tourConfig, saveTourPref, IDLE_MS, DWELL, FLY_MS, SETTLE_MS, THROTTLE_MS } from '../src/composables/useTour.js'

// 假时钟：setTimeout 排进列表，advance 按时刻顺序执行（每个回调后冲刷微任务，async 步骤能接着走）
function fakeClock() {
  let t = 0
  let id = 0
  const timers = new Map()
  const flush = () => new Promise((r) => setImmediate(r))
  return {
    now: () => t,
    setTimeout: (fn, ms) => (timers.set(++id, { at: t + Math.max(0, ms || 0), fn }), id),
    clearTimeout: (h) => timers.delete(h),
    async advance(ms) {
      const end = t + ms
      await flush()
      for (;;) {
        let next = null
        for (const [h, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [h, x]
        if (!next) break
        timers.delete(next[0])
        t = next[1].at
        next[1].fn()
        await flush()
        await flush()
      }
      t = end
      await flush()
    },
    pending: () => timers.size,
  }
}

function setup({ ok = true, reading = false, plan, visible = true } = {}) {
  const clock = fakeClock()
  const calls = []
  const env = { ok, reading, visible, mode: 'markers', metric: 'projects', pop: null, rows: [], shown: [] }
  const fly = (name) => (...a) => {
    calls.push([name, ...a.slice(0, 1)])
    const ms = typeof a[a.length - 1] === 'object' ? a[a.length - 1].ms : a[a.length - 1]
    return new Promise((r) => clock.setTimeout(() => {
      if (name === 'flyCommunity' && a[1].alive()) env.pop = a[1].by
      r(true)
    }, (ms ?? FLY_MS) + SETTLE_MS))
  }
  const api = {
    flyCity: fly('flyCity'),
    flyDistrict: fly('flyDistrict'),
    flyCommunity: fly('flyCommunity'),
    closePop: ({ onlyIf } = {}) => {
      calls.push(['closePop', onlyIf])
      if (!onlyIf || env.pop === onlyIf) env.pop = null
    },
    popOpenedBy: () => env.pop,
    claimPop: () => (env.pop = 'user'),
  }
  const target = new EventTarget()
  const doc = new EventTarget()
  const p = plan || {
    story: 'alarm',
    city: '无锡市 · 10 个项目 · 进行中告警 3',
    districts: [
      { key: 'd1', name: '滨湖区', label: '滨湖区 · 5', community: 'c1', communityChip: 'C1', alarmId: 'a1' },
      { key: 'd2', name: '惠山区', label: '惠山区 · 3', community: null },
    ],
  }
  const tour = useTour({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    target,
    doc,
    visible: () => env.visible,
    map: () => api,
    canStart: () => ({ ok: env.ok, reading: env.reading }),
    plan: () => p,
    getMode: () => env.mode,
    setMode: (m) => (env.mode = m),
    getMetric: () => env.metric,
    setMetric: (m) => (env.metric = m),
    setRow: (r) => env.rows.push(r),
    showAlarm: (id, o) => env.shown.push([id, o.flash]),
    revealUnlocated: () => {},
    closeOverlays: () => (env.closed = true),
    reduced: () => false,
    dip: () => {},
  })
  const fire = (type, init = {}) => {
    if (init.target) return tour.onInput({ type, ...init }) // 带目标元素的事件：直接喂（Event.target 只读）
    const e = new Event(type)
    Object.assign(e, init)
    target.dispatchEvent(e)
  }
  return { clock, tour, env, calls, fire, target, doc }
}

test('配置：?tour=off / now / 秒数（30–3600）、localStorage 持久禁用', () => {
  const st = (o) => ({ getItem: (k) => o[k] ?? null })
  assert.deepEqual(tourConfig({ hash: '#/dealer-map?tour=off' }), { enabled: false, now: false, idleMs: IDLE_MS })
  assert.deepEqual(tourConfig({ search: '?tour=now' }), { enabled: true, now: true, idleMs: IDLE_MS })
  assert.equal(tourConfig({ hash: '#/x?tour=1' }).now, true)
  assert.equal(tourConfig({ hash: '#/x?tour=45' }).idleMs, 45000)
  assert.equal(tourConfig({ hash: '#/x?tour=5' }).idleMs, 30000)
  assert.equal(tourConfig({ storage: st({ dm_tour: 'off' }) }).enabled, false)
  assert.equal(tourConfig({ storage: st({ dm_tour_idle: '300' }) }).idleMs, 300000)
  // 默认开；dm_tour='on' 同默认；?tour=now 覆盖持久关（本次会话）、?tour=off 覆盖持久开
  assert.equal(tourConfig({}).enabled, true)
  assert.equal(tourConfig({ storage: st({ dm_tour: 'on' }) }).enabled, true)
  assert.deepEqual(tourConfig({ search: '?tour=now', storage: st({ dm_tour: 'off' }) }), { enabled: true, now: true, idleMs: IDLE_MS })
  assert.equal(tourConfig({ search: '?tour=off', storage: st({ dm_tour: 'on' }) }).enabled, false)
  const mem = {}
  const ws = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)) }
  saveTourPref(false, ws)
  assert.equal(tourConfig({ storage: ws }).enabled, false)
  saveTourPref(true, ws)
  assert.equal(tourConfig({ storage: ws }).enabled, true)
  saveTourPref(true, { setItem: () => { throw new Error('quota') } }) // 隐私模式不抛
})

test('开关：巡览中关掉立即退出且不再计时；重新打开从此刻计 120 s', async () => {
  const { clock, tour, env } = setup()
  env.mode = 'markers'
  await clock.advance(IDLE_MS + 1)
  assert.equal(tour.state.value, 'running')
  tour.setEnabled(false)
  assert.equal(tour.enabled.value, false)
  assert.equal(tour.state.value, 'idle')
  assert.equal(tour.chip.show, false)
  assert.equal(tour.start(), false)
  await clock.advance(IDLE_MS * 10)
  assert.equal(tour.state.value, 'idle')
  assert.equal(tour.debug().idleArmed, false)
  tour.setEnabled(true)
  await clock.advance(IDLE_MS - 1)
  assert.equal(tour.state.value, 'idle')
  await clock.advance(2)
  assert.equal(tour.state.value, 'running')
})

test('开关：初始关（enabled:false）时监听仍在，打开后按空闲规则开始', async () => {
  const clock = fakeClock()
  const target = new EventTarget()
  const tour = useTour({ enabled: false, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, target, doc: new EventTarget(), visible: () => true, map: () => null, canStart: () => ({ ok: true }), plan: () => ({ story: 'alarm', city: 'X', districts: [] }), getMode: () => 'markers', setMode: () => {}, getMetric: () => 'projects', setMetric: () => {} })
  await clock.advance(IDLE_MS * 2)
  assert.equal(tour.state.value, 'idle')
  tour.setEnabled(true)
  await clock.advance(IDLE_MS + 1)
  assert.equal(tour.state.value, 'running')
  tour.setEnabled(false)
  assert.equal(tour.state.value, 'idle')
})

test('120 s 无输入开始；输入只推迟（不按每次输入重置计时器）', async () => {
  const { clock, tour, fire } = setup()
  await clock.advance(60000)
  fire('keydown')
  await clock.advance(IDLE_MS - 1)
  assert.equal(tour.state.value, 'idle')
  await clock.advance(60000)
  assert.equal(tour.state.value, 'running')
  assert.equal(tour.chip.show, true)
  assert.equal(tour.chip[tour.chip.cur], '无锡市 · 10 个项目 · 进行中告警 3')
})

test('输入后同步退出（≤ 100 ms）：state idle、胶囊收起、巡览弹窗关闭、模式恢复、之后不再有相机调用', async () => {
  const { clock, tour, env, calls, fire } = setup()
  env.mode = 'heat'
  await clock.advance(IDLE_MS)
  assert.equal(env.mode, 'markers', '巡览把模式切到点位')
  // 走到 1b（小区弹窗）
  await clock.advance(FLY_MS + SETTLE_MS + DWELL.city + FLY_MS + SETTLE_MS + DWELL.district + FLY_MS + SETTLE_MS + 10)
  assert.equal(tour.step.value, 'community')
  assert.equal(env.pop, 'tour')
  assert.deepEqual(env.rows.at(-1), { district: '滨湖区', alarmId: 'a1' })
  fire('pointerdown', { clientX: 5, clientY: 5, target: { closest: () => null } })
  assert.equal(tour.state.value, 'idle')
  assert.equal(tour.chip.show, false)
  assert.equal(env.pop, null)
  assert.equal(env.rows.at(-1), null)
  assert.equal(env.mode, 'heat', '恢复巡览前的模式')
  const n = calls.length
  await clock.advance(60000)
  assert.equal(calls.length, n, '旧回调（seq 不符）不执行')
  // 重新计 120 s
  await clock.advance(IDLE_MS)
  assert.equal(tour.state.value, 'running')
})

test('点在巡览弹窗上退出：弹窗保留并归人', async () => {
  const { clock, tour, env, fire } = setup()
  await clock.advance(IDLE_MS + FLY_MS + SETTLE_MS + DWELL.city + FLY_MS + SETTLE_MS + DWELL.district + FLY_MS + SETTLE_MS + 10)
  assert.equal(env.pop, 'tour')
  fire('pointerdown', { clientX: 1, clientY: 1, target: { closest: (s) => (s === '.dm-pop' ? {} : null) } })
  assert.equal(tour.state.value, 'idle')
  assert.equal(env.pop, 'user')
})

test('pointermove < 6 px 不算输入；首个 move 只记点', async () => {
  const { clock, tour, fire } = setup()
  await clock.advance(IDLE_MS)
  assert.equal(tour.state.value, 'running')
  fire('pointermove', { clientX: 100, clientY: 100 })
  fire('pointermove', { clientX: 103, clientY: 103 })
  assert.equal(tour.state.value, 'running')
  fire('pointermove', { clientX: 106, clientY: 104 })
  assert.equal(tour.state.value, 'idle')
})

test('人开着弹窗 / 下拉：600 s 才开始，开始时收起它们', async () => {
  const { clock, tour, env } = setup({ reading: true })
  await clock.advance(IDLE_MS * 4)
  assert.equal(tour.state.value, 'idle')
  await clock.advance(IDLE_MS + 1)
  assert.equal(tour.state.value, 'running')
  assert.equal(env.closed, true)
})

test('前置条件不满足：到点后每 10 s 再查', async () => {
  const { clock, tour, env } = setup({ ok: false })
  await clock.advance(IDLE_MS + 30000)
  assert.equal(tour.state.value, 'idle')
  env.ok = true
  await clock.advance(10000)
  assert.equal(tour.state.value, 'running')
})

test('hidden 即停且不计空闲；visible 后从 0 计 120 s', async () => {
  const { clock, tour, env, doc } = setup()
  await clock.advance(IDLE_MS)
  assert.equal(tour.state.value, 'running')
  env.visible = false
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(tour.state.value, 'idle')
  await clock.advance(IDLE_MS * 3)
  assert.equal(tour.state.value, 'idle')
  env.visible = true
  doc.dispatchEvent(new Event('visibilitychange'))
  await clock.advance(IDLE_MS - 1)
  assert.equal(tour.state.value, 'idle')
  await clock.advance(1)
  assert.equal(tour.state.value, 'running')
})

test('一轮：城市 → 区县 → 小区 → 区县（无小区，8 s）→ 热力项目 / 告警 → 回 #0，总长与脚本一致', async () => {
  const { clock, tour, env, calls } = setup()
  await clock.advance(IDLE_MS)
  const fly = FLY_MS + SETTLE_MS
  const loopMs = fly + DWELL.city + (fly + DWELL.district + fly + DWELL.community + 300) + (fly + DWELL.districtOnly) + fly + DWELL.heat * 2 + 300
  await clock.advance(loopMs - 50)
  assert.equal(env.mode, 'markers')
  assert.deepEqual(calls.filter((c) => c[0].startsWith('fly')).map((c) => c[0]), ['flyCity', 'flyDistrict', 'flyCommunity', 'flyDistrict', 'flyCity'])
  assert.ok(env.metric === 'alarms')
  await clock.advance(100)
  assert.equal(tour.step.value, 'city')
  assert.equal(calls.filter((c) => c[0] === 'flyCity').length, 3)
})

test('规模剧本跳过告警热力', async () => {
  const { clock, env } = setup({ plan: { story: 'scale', city: 'x', districts: [] } })
  await clock.advance(IDLE_MS + FLY_MS + SETTLE_MS + DWELL.city + FLY_MS + SETTLE_MS + DWELL.heat + 10)
  assert.equal(env.metric, 'projects')
  assert.equal(env.mode, 'markers')
})

test('插播：打断 → 飞到小区 15 s → 回 #0；队列上限 3（留最新）；同小区 10 min 节流', async () => {
  const { clock, tour, env, calls } = setup()
  await clock.advance(IDLE_MS + 3000)
  assert.equal(tour.interrupt({ key: 'n1', located: true, alarmId: 'x1', chip: '新一级告警 · N1' }), true)
  await clock.advance(1)
  assert.equal(tour.step.value, 'interrupt')
  assert.equal(tour.chip.alarm, true)
  assert.deepEqual(env.shown.at(-1), ['x1', true])
  for (const k of ['q1', 'q2', 'q3', 'q4']) tour.interrupt({ key: k, located: true, alarmId: k, chip: k })
  assert.equal(tour.debug().queue, 3)
  await clock.advance(FLY_MS + SETTLE_MS + DWELL.interrupt + 5)
  const comm = calls.filter((c) => c[0] === 'flyCommunity').map((c) => c[1])
  assert.deepEqual(comm, ['n1', 'q2'], '溢出丢最旧的 q1')
  await clock.advance(3 * (FLY_MS + SETTLE_MS + DWELL.interrupt))
  assert.deepEqual(calls.filter((c) => c[0] === 'flyCommunity').map((c) => c[1]).slice(0, 4), ['n1', 'q2', 'q3', 'q4'])
  assert.equal(tour.chip.alarm, false)
  // 节流：n1 10 min 内再来不插播
  const before = calls.filter((c) => c[0] === 'flyCommunity').length
  tour.interrupt({ key: 'n1', located: true, alarmId: 'x9', chip: 'again' })
  await clock.advance(10)
  assert.notEqual(tour.step.value, 'interrupt')
  assert.ok(calls.filter((c) => c[0] === 'flyCommunity').length <= before + 1)
  await clock.advance(THROTTLE_MS)
  assert.equal(tour.state.value, 'running')
})

test('未定位插播：不动镜头，原步骤暂停 6 s 后继续', async () => {
  const { clock, tour, calls } = setup()
  await clock.advance(IDLE_MS + FLY_MS + SETTLE_MS + 1000) // 城市停留第 1 s
  const n = calls.length
  tour.interrupt({ key: 'u1', located: false, alarmId: 'u', chip: '新一级告警 · U（未定位）' })
  assert.equal(tour.chip[tour.chip.cur], '新一级告警 · U（未定位）')
  await clock.advance(DWELL.city - 1000 + 100)
  assert.equal(calls.length, n, '暂停期间不飞')
  assert.equal(tour.step.value, 'city')
  await clock.advance(DWELL.interruptUnlocated)
  assert.equal(tour.step.value, 'district')
  assert.equal(tour.chip.alarm, false)
})

test('非巡览中 interrupt 返回 false（调用方只做列表提示）', () => {
  const { tour } = setup()
  assert.equal(tour.interrupt({ key: 'k', located: true }), false)
  tour.dispose()
})
