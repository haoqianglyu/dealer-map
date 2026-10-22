// 中间层级聚合（src/geo/cluster.js）：层级阈值、圈尺寸、告警上卷、终态合并、包含项查找、标签避让
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildIndexes, query, levelFor, zoomClusterFor, circleSize, membersOf, expansionZoom, layoutLabels, queryZoom } from '../src/geo/cluster.js'

const P = (id, state = 'normal', extra = {}) => ({ id, state, ...extra })
const C = (key, lnglat, projects, label = key, districtName = '滨湖区') => ({ key, lnglat, label, districtName, projects })
const WORLD = [-180, -85, 180, 85]

test('层级阈值：区县 / 簇 / 小区 / 终态；簇分界随城市视野走并夹在 10.8–11.8', () => {
  assert.equal(zoomClusterFor(9.86), 10.8)
  assert.equal(zoomClusterFor(10.7), 11.5)
  assert.equal(zoomClusterFor(11.16), 11.8)
  assert.equal(zoomClusterFor(undefined), 11.5)
  const zc = 11.5
  assert.equal(levelFor(11.4, zc), 'district')
  assert.equal(levelFor(11.5, zc), 'cluster')
  assert.equal(levelFor(13.99, zc), 'cluster')
  assert.equal(levelFor(14, zc), 'named')
  assert.equal(levelFor(16, zc), 'terminal')
  assert.equal(queryZoom(18.3), 16)
  assert.equal(queryZoom(12.9), 12)
})

test('圈直径：28–64，按 √n', () => {
  assert.equal(circleSize(1), 28)
  assert.equal(Math.round(circleSize(9)), 39)
  assert.equal(circleSize(16), 44)
  assert.equal(circleSize(200), 64)
})

// 太湖新城一带：三个挨着的小区（其一有告警）+ 远处一个
const near = [
  C('a', [120.3, 31.49], [P(1), P(2)], '甲小区'),
  C('b', [120.301, 31.4905], [P(3, 'alarm', { alarmCount: 2, newAlarm: true })], '乙小区'),
  C('c', [120.302, 31.4895], [P(4, 'offline'), P(5), P(6)], '丙小区', '梁溪区'),
  C('far', [120.6, 31.8], [P(7)], '远小区'),
]

test('12 级：相邻小区并成一个簇，项目数 / 小区数 / 告警 / 脉冲 / 最严重状态逐级上卷', () => {
  const idx = buildIndexes(near)
  const items = query(idx, 'cluster', WORLD, 12.4)
  assert.equal(items.length, 2)
  const cl = items.find((i) => i.k === 3)
  assert.ok(cl, '三个相邻小区合并')
  assert.equal(cl.n, 6)
  assert.equal(cl.alarms, 2)
  assert.equal(cl.pulse, true)
  assert.equal(cl.state, 'alarm')
  assert.equal(cl.top, '乙小区', '告警小区的名字优先')
  assert.deepEqual(cl.dists.split('|').sort(), ['梁溪区', '滨湖区'])
  assert.match(cl.id, /^c:12:/)
  const far = items.find((i) => i.k === 1)
  assert.equal(far.id, 'p:far')
  // 成员 + 展开级别
  assert.deepEqual(membersOf(idx, cl).map((c) => c.key).sort(), ['a', 'b', 'c'])
  const ez = expansionZoom(cl)
  assert.ok(ez > 12 && ez <= 17)
})

test('终态：同坐标（分期）的小区放大到 18 级仍是一个簇，展开级别 > 16', () => {
  const same = [C('一期', [120.3, 31.49], [P(1)]), C('二期', [120.3, 31.49], [P(2, 'alarm')]), C('x', [120.4, 31.6], [P(3)])]
  const idx = buildIndexes(same)
  const items = query(idx, 'terminal', WORLD, 18)
  const cl = items.find((i) => i.k === 2)
  assert.ok(cl)
  assert.equal(cl.state, 'alarm')
  assert.ok(expansionZoom(cl) > 16)
  // 告警聚焦：在终态找到包含某小区的项
  const hitItem = items.find((i) => membersOf(idx, i).some((c) => c.key === '二期'))
  assert.equal(hitItem, cl)
})

test('14 级 48 px：相距 ~100 m 的两个小区并成胶囊，16 级拆开', () => {
  const two = [C('m', [120.3, 31.49], [P(1)]), C('n', [120.302, 31.49], [P(2)])]
  const idx = buildIndexes(two)
  assert.equal(query(idx, 'named', WORLD, 14).length, 1)
  assert.equal(query(idx, 'terminal', WORLD, 16).length, 2)
})

test('界面放大 k：半径同比放大', () => {
  // 两点相距 ~50 px（z12）：k=1 时 64 px 内合并；48 px 半径的 named 索引在 z12 不适用，这里用 cluster 索引比 k
  const pts = [C('m', [120.3, 31.49], [P(1)]), C('n', [120.3, 31.5], [P(2)])]
  const n = (k, z) => query(buildIndexes(pts, k), 'cluster', WORLD, z).length
  assert.equal(n(1, 13), 2) // z13 约 100 px 远
  assert.equal(n(2, 13), 1) // 半径 128 px → 合并
})

test('标签避让：簇级只给多小区簇标「k 小区」，撞圈不标；胶囊互压时低优先级退化为圆；同名只出现一次', () => {
  const items = [
    { id: 'A', x: 100, y: 100, n: 9, k: 3, rank: 3, alarms: 1 },
    { id: 'B', x: 100, y: 135, n: 1, k: 1, rank: 0, alarms: 0 }, // 紧贴 A 下方：A 的标签会压到它
    { id: 'C', x: 300, y: 100, n: 4, k: 2, rank: 0, alarms: 0 },
  ]
  const l1 = layoutLabels(items, 'cluster')
  assert.equal(l1.get('A').label, '')
  assert.equal(l1.get('B').label, '')
  assert.equal(l1.get('C').label, '2 小区')
  const caps = [
    { id: 'X', x: 100, y: 100, n: 5, k: 1, rank: 0, alarms: 0, top: '融创熙园' },
    { id: 'Y', x: 190, y: 128, n: 3, k: 1, rank: 3, alarms: 1, top: '融创花溪美墅' },
    { id: 'Z', x: 600, y: 100, n: 2, k: 2, rank: 0, alarms: 0, top: '建发和玺' },
    { id: 'W', x: 900, y: 100, n: 2, k: 2, rank: 0, alarms: 0, top: '建发和玺' },
  ]
  const l2 = layoutLabels(caps, 'named')
  assert.equal(l2.get('Y').named, true, '告警的优先')
  assert.equal(l2.get('X').named, false)
  assert.equal(l2.get('Z').sub, '等 2 小区')
  assert.equal(l2.get('W').named, false, '同文本只出现一次')
  // 胶囊会压住别的圈：两个都退化成圆（宁可不标名字也不互压）
  const l3 = layoutLabels([caps[0], { ...caps[1], x: 140, y: 100 }], 'named')
  assert.equal(l3.get('X').named || l3.get('Y').named, false)
})

test('区县放大：主体框丢掉远处离群点，集中时不误杀', async () => {
  const { mainMass } = await import('../src/geo/cluster.js')
  const core = Array.from({ length: 30 }, (_, i) => [120.28 + (i % 6) * 0.01, 31.52 + Math.floor(i / 6) * 0.008])
  const far = [[120.3, 31.2], [120.05, 31.55]]
  const kept = mainMass([...core, ...far])
  assert.ok(kept.every((p) => p[1] > 31.4 && p[0] > 120.2), 'outliers dropped')
  assert.ok(kept.length >= 24, `core kept (${kept.length})`)
  const tight = [[120, 31], [120.001, 31], [120, 31.001], [120.002, 31.001], [120.004, 31.002]]
  assert.equal(mainMass(tight).length, 5)
  assert.equal(mainMass([[1, 1], [2, 2]]).length, 2)
})

test('动画父项：放大后新项的成员 key 落在上一帧的簇里', () => {
  return import('../src/geo/cluster.js').then(({ leafIndex, anyLeafKey }) => {
    const cs = [C('a', [120.3, 31.5], [P(1)]), C('b', [120.302, 31.501], [P(2)]), C('c', [120.6, 31.7], [P(3)])]
    const idx = buildIndexes(cs)
    const before = query(idx, 'cluster', WORLD, 10)
    const after = query(idx, 'named', WORLD, 16)
    const m = leafIndex(before)
    const cl = before.find((i) => i.k === 2)
    assert.ok(cl)
    for (const it of after) {
      const par = m.get(anyLeafKey(it))
      assert.ok(par)
      if (['a', 'b'].includes(anyLeafKey(it))) assert.equal(par.id, cl.id)
    }
  })
})
