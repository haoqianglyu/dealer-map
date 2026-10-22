import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toOnlineSet, isOnline, applyOnline, onlineSummary, groupsOnlineStats } from '../src/geo/online.js'

test('接口失败 / 空 / 结构不对 → 未知（null），不判离线', () => {
  for (const d of [null, undefined, {}, { ids: [] }, { ids: 'x' }, { data: { ids: ['a'] } }]) assert.equal(toOnlineSet(d), null)
  const ps = [{ id: 'a' }, { id: 'b' }]
  assert.equal(applyOnline(ps, null), ps)
  assert.equal(isOnline(null, 'a'), null)
  assert.equal(onlineSummary(ps, null), null)
  assert.equal(groupsOnlineStats([{ projects: ps }], null), null)
})

test('数字 / 字符串 id 等同；不在列表 = 离线', () => {
  const set = toOnlineSet({ ids: [1, 'b'] })
  assert.deepEqual(applyOnline([{ id: '1' }, { id: 'b' }, { id: 'c' }], set).map((p) => p.online), [true, true, false])
  assert.equal(isOnline(set, 'c'), false)
})

test('小区汇总：全部离线 / 混合 / 全部在线', () => {
  const set = toOnlineSet({ ids: ['a', 'b', 'c'] })
  const groups = [{ projects: [{ id: 'x' }, { id: 'y' }] }, { projects: [{ id: 'a' }, { id: 'z' }] }, { projects: [{ id: 'b' }, { id: 'c' }] }]
  assert.deepEqual(onlineSummary(groups[1].projects, set), { online: 1, offline: 1, total: 2, allOffline: false, mixed: true })
  assert.deepEqual(groupsOnlineStats(groups, set), { online: 3, total: 6, groups: { allOffline: 1, mixed: 1, allOnline: 1 } })
})
