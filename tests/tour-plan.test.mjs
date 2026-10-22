import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTour, cityChip, newAlarms, shortArea } from '../src/geo/tourPlan.js'

let aid = 0
// 进行中一级告警的项目：state = 'alarm'、alarmCount = n（与 states.alarmStates 的结果同形）
const proj = (n = 0, ts = 1000, area = 100) => ({
  id: `p${++aid}`,
  area,
  state: n ? 'alarm' : 'normal',
  alarmCount: n,
  alarms: Array.from({ length: n }, (_, i) => ({ id: `a${aid}_${i}`, level: 1, status: 1, ts: ts + i })),
})
const comm = (key, district, projects, ll = [120, 31]) => ({ key, district, label: key.split('|')[1] || key, lnglat: ll, projects })
const dist = (key, label, comms, extra = []) => ({ key, label, lnglat: [120, 31], projects: [...comms.flatMap((c) => c.projects), ...extra], unlocatedProjects: extra })

function fixture() {
  const a1 = comm('320211|A1', '320211', [proj(2, 5000), proj(0)])
  const a2 = comm('320211|A2', '320211', [proj(2, 6000)]) // 与 A1 并列 2 条，最新告警更新 → 选它
  const b1 = comm('320206|B1', '320206', [proj(1), proj(0), proj(0)])
  const c1 = comm('320213|C1', '320213', [proj(0), proj(0), proj(0), proj(0)])
  const e1 = comm('320214|E1', '320214', [proj(0)])
  const communities = [a1, a2, b1, c1, e1]
  const districts = [dist('320211', '滨湖区', [a1, a2]), dist('320206', '惠山区', [b1]), dist('320213', '梁溪区', [c1]), dist('320214', '新吴区', [e1]), dist('310101', '黄浦区', [comm('310101|X', '310101', [proj(9)])])]
  return { communities, districts }
}

test('告警剧本：按进行中告警数排序，不足 3 区用项目数补齐（标签「无进行中告警」），其它城市不选', () => {
  const { communities, districts } = fixture()
  const p = planTour({ districts, communities, cityCode: '320200', alarmsUsable: true })
  assert.equal(p.story, 'alarm')
  assert.deepEqual(p.districts.map((d) => d.key), ['320211', '320206', '320213'])
  assert.equal(p.districts[0].label, '滨湖区 · 3 个项目 · 4 条进行中告警')
  assert.equal(p.districts[2].label, '梁溪区 · 4 个项目 · 无进行中告警')
  // 并列告警数取最新告警 ts
  assert.equal(p.districts[0].community, '320211|A2')
  assert.equal(p.districts[0].communityChip, 'A2 · 2 条进行中告警')
  assert.ok(p.districts[0].alarmId.endsWith('_1'), '焦点告警 = 该小区最新一条进行中告警')
})

test('告警数并列 → 项目数降序 → key 升序（稳定）', () => {
  const x = comm('320201|X', '320201', [proj(1), proj(0)])
  const y = comm('320202|Y', '320202', [proj(1), proj(0)])
  const z = comm('320203|Z', '320203', [proj(1)])
  const p = planTour({ districts: [dist('320203', 'Z', [z]), dist('320202', 'Y', [y]), dist('320201', 'X', [x])], communities: [x, y, z], cityCode: '320200', alarmsUsable: true })
  assert.deepEqual(p.districts.map((d) => d.key), ['320201', '320202', '320203'])
})

test('跨区去重：同一小区一轮只出现一次', () => {
  const shared = comm('320211|S', '320211', [proj(3)])
  const other = comm('320211|O', '320211', [proj(1)])
  // 两个区县条目都引用同一小区（区界上的小区可能同时算在两区）
  const d1 = dist('320211', '滨湖区', [shared, other])
  const d2 = { ...dist('320211', '滨湖区2', [shared, other]), key: '320211' }
  const p = planTour({ districts: [d1, d2], communities: [shared, other, { ...other }], cityCode: '320200', alarmsUsable: true })
  const keys = p.districts.map((d) => d.community).filter(Boolean)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(keys, ['320211|S', '320211|O'])
})

test('告警全部在未定位小区 → community null + unlocatedOnly', () => {
  const loc = comm('320211|L', '320211', [proj(0)])
  const d = dist('320211', '滨湖区', [loc], [proj(2)])
  const p = planTour({ districts: [d], communities: [loc], cityCode: '320200', alarmsUsable: true })
  assert.equal(p.story, 'alarm')
  assert.deepEqual([p.districts[0].community, p.districts[0].unlocatedOnly, p.districts[0].unlocatedAlarms], [null, true, 2])
})

test('规模剧本：alarmsUsable=false 或 0 条进行中告警；按项目数取 3，焦点 = 项目最多的小区（并列取面积大）', () => {
  const { communities, districts } = fixture()
  for (const usable of [false]) {
    const p = planTour({ districts, communities, cityCode: '320200', alarmsUsable: usable })
    assert.equal(p.story, 'scale')
    assert.deepEqual(p.districts.map((d) => d.key), ['320213', '320206', '320211'])
    assert.equal(p.districts[0].label, '梁溪区 · 4 个项目')
    assert.equal(p.districts[0].communityChip, 'C1 · 4 个项目 · 400 ㎡')
    assert.equal(p.districts[0].alarmId, null)
  }
  const big = comm('320201|Big', '320201', [proj(0, 0, 9000), proj(0, 0, 3000)])
  const small = comm('320201|Small', '320201', [proj(0, 0, 10), proj(0, 0, 10)])
  const p = planTour({ districts: [dist('320201', 'D', [small, big])], communities: [small, big], cityCode: '320200', alarmsUsable: true })
  assert.equal(p.story, 'scale')
  assert.equal(p.districts[0].community, '320201|Big')
  assert.equal(p.districts[0].communityChip, 'Big · 2 个项目 · 1.2 万㎡')
})

test('区县 < 3：有几个讲几个；0 个 → 空；#id 单项目组与无坐标小区不选', () => {
  const lone = comm('#123', '320211', [proj(5)])
  const p = planTour({ districts: [dist('320211', '滨湖区', [lone])], communities: [lone], cityCode: '320200', alarmsUsable: true })
  assert.equal(p.districts.length, 1)
  assert.equal(p.districts[0].community, null)
  assert.equal(planTour({ districts: [], communities: [], cityCode: '320200', alarmsUsable: true }).districts.length, 0)
})

test('城市胶囊 / 面积短写', () => {
  assert.equal(cityChip({ story: 'alarm', cityName: '无锡市', projects: 595, communities: 336, activeAlarms: 23 }), '无锡市 · 595 个项目 · 进行中告警 23')
  assert.equal(cityChip({ story: 'scale', cityName: '无锡市', projects: 595, communities: 336, activeAlarms: 0 }), '无锡市 · 595 个项目 · 336 个小区')
  assert.equal(shortArea(12345), '1.2 万㎡')
})

test('新告警判定：未见过 + 进行中 + 一级 + 新于上次轮询 − 5 min；按 ts 降序', () => {
  const now = 10_000_000
  const seen = new Set(['old'])
  const list = [
    { id: 'old', level: 1, status: 1, ts: now },
    { id: 'n1', level: 1, status: 1, ts: now - 1000 },
    { id: 'n2', level: 1, status: 2, ts: now - 100 },
    { id: 'done', level: 1, status: 3, ts: now },
    { id: 'l2', level: 2, status: 1, ts: now },
    { id: 'late', level: 1, status: 1, ts: now - 60 * 60e3 }, // 补录的旧告警
  ]
  assert.deepEqual(newAlarms(list, seen, now - 60e3).map((a) => a.id), ['n2', 'n1'])
})
