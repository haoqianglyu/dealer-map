import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toOnlineSet, isOnline, applyOnline, onlineSummary, groupsOnlineStats, createOnlineTracker, sane, allOffline, offlineCount, STALE_MS } from '../src/geo/online.js'
import { buildIndexes, query } from '../src/geo/cluster.js'

test('接口失败 / 空 / 结构不对 → null（当失败处理）', () => {
  for (const d of [null, undefined, {}, { ids: [] }, { ids: 'x' }, { data: { ids: ['a'] } }]) assert.equal(toOnlineSet(d), null)
  assert.equal(isOnline(null, 'a'), null)
  assert.equal(onlineSummary([{ id: 'a' }], null), null)
  assert.equal(groupsOnlineStats([{ projects: [{ id: 'a' }] }], null), null)
})

test('未知：online = null、offline = false（不判离线）', () => {
  const ps = applyOnline([{ id: 'a' }, { id: 'b' }], null)
  assert.deepEqual(ps.map((p) => [p.online, p.offline]), [[null, false], [null, false]])
  assert.equal(allOffline(ps), false)
  assert.equal(offlineCount(ps), 0)
})

test('滞后：标记要连续 2 次成功轮询都离线才灰；弹窗点即时', () => {
  const tr = createOnlineTracker({ now: () => 0 })
  const ps = [{ id: '1' }, { id: 'b' }, { id: 'c' }]
  let v = tr.update(toOnlineSet({ ids: [1, 'b'] }))
  let out = applyOnline(ps, v)
  assert.deepEqual(out.map((p) => p.online), [true, true, false])
  assert.deepEqual(out.map((p) => p.offline), [false, false, false]) // 第一次：不灰
  v = tr.update(toOnlineSet({ ids: ['b'] }))
  out = applyOnline(ps, v)
  assert.deepEqual(out.map((p) => p.online), [false, true, false])
  assert.deepEqual(out.map((p) => p.offline), [false, false, true]) // c 连续两次 → 灰；1 刚掉线 → 不灰
  v = tr.update(toOnlineSet({ ids: ['b', 'c'] }))
  assert.deepEqual(applyOnline(ps, v).map((p) => p.offline), [true, false, false]) // c 上线立即恢复
})

test('失败沿用上一次 ≤ 5 分钟（stale），超过 → 未知', () => {
  let t = 0
  const tr = createOnlineTracker({ now: () => t })
  tr.update(toOnlineSet({ ids: ['a'] }))
  t = 60e3
  let v = tr.update(null)
  assert.equal(v.stale, true)
  assert.equal(v.updatedAt, 0)
  assert.ok(v.cur.has('a'))
  t = STALE_MS + 1
  v = tr.update(toOnlineSet({ ids: [] }))
  assert.equal(v, null)
  // 恢复后重新开始计滞后
  t += 60e3
  v = tr.update(toOnlineSet({ ids: ['a'] }))
  assert.equal(v.prev, null)
  assert.equal(applyOnline([{ id: 'x' }], v)[0].offline, false)
})

test('与本账号项目一个都对不上 → 未知（永不全灰）', () => {
  const tr = createOnlineTracker()
  tr.update(toOnlineSet({ ids: ['zz'] }))
  const v = tr.update(toOnlineSet({ ids: ['zz'] }))
  assert.equal(sane(v, [{ id: 'a' }, { id: 'b' }]), null)
  assert.equal(sane(v, [{ id: 'a' }, { id: 'zz' }]), v)
})

test('全部离线才灰；告警 / 预警永远赢', () => {
  assert.equal(allOffline([{ offline: true }, { offline: true }]), true)
  assert.equal(allOffline([{ offline: true }, { offline: false }]), false)
  assert.equal(allOffline([{ offline: true, state: 'alarm' }]), false)
  assert.equal(allOffline([{ offline: true, state: 'warning' }]), false)
  assert.equal(allOffline([]), false)
})

test('簇：成员全部离线才灰（任何级别）', () => {
  const off = (id) => ({ id, offline: true, online: false, state: 'normal' })
  const on = (id) => ({ id, offline: false, online: true, state: 'normal' })
  const cs = [
    { key: 'A', lnglat: [120.3, 31.5], label: 'A', projects: [off('1'), off('2')] },
    { key: 'B', lnglat: [120.3001, 31.5001], label: 'B', projects: [off('3')] },
    { key: 'C', lnglat: [120.5, 31.7], label: 'C', projects: [off('4'), on('5')] },
  ]
  const idx = buildIndexes(cs)
  const items = query(idx, 'cluster', [119, 30, 122, 33], 12)
  const ab = items.find((i) => i.k === 2)
  const c = items.find((i) => i.key === 'C')
  assert.equal(ab.offline, true)
  assert.equal(c.offline, false)
  const all = query(idx, 'cluster', [119, 30, 122, 33], 3)
  assert.equal(all.length, 1)
  assert.equal(all[0].offline, false)
})

test('小区汇总：全部离线 / 混合 / 全部在线', () => {
  const set = toOnlineSet({ ids: ['a', 'b', 'c'] })
  const groups = [{ projects: [{ id: 'x' }, { id: 'y' }] }, { projects: [{ id: 'a' }, { id: 'z' }] }, { projects: [{ id: 'b' }, { id: 'c' }] }]
  assert.deepEqual(onlineSummary(groups[1].projects, set), { online: 1, offline: 1, total: 2, allOffline: false, mixed: true })
  assert.deepEqual(groupsOnlineStats(groups, { cur: set }), { online: 3, total: 6, groups: { allOffline: 1, mixed: 1, allOnline: 1 } })
})
