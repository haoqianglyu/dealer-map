import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isActiveAlarm, alarmTag, alarmStates, byProjectPriority, byActiveFirst, isOffRow } from '../src/geo/states.js'

test('告警状态：1 未处理 / 2 处理中 = 进行中；3 已处理、有 end_timestamp = 结束', () => {
  assert.equal(isActiveAlarm({ status: 1, end: 0 }), true)
  assert.equal(isActiveAlarm({ status: 2, end: 0 }), true)
  assert.equal(isActiveAlarm({ status: 3, end: 0 }), false)
  assert.equal(isActiveAlarm({ status: 1, end: 123 }), false)
  assert.equal(isActiveAlarm({ status: 2, end: 123 }), false)
  assert.equal(isActiveAlarm({ status: 0, end: 0 }), false)
})

test('标签：已恢复 > 已处理 > 处理中；未处理无标签', () => {
  assert.equal(alarmTag({ status: 1, end: 0 }), '')
  assert.equal(alarmTag({ status: 2, end: 0 }), '处理中')
  assert.equal(alarmTag({ status: 3, end: 0 }), '已处理')
  assert.equal(alarmTag({ status: 1, end: 5 }), '已恢复')
  assert.equal(alarmTag({ status: 2, end: 5 }), '已恢复')
  assert.equal(alarmTag({ status: 3, end: 5 }), '已恢复')
})

test('处理中的一级告警仍让项目标红并计入角标', () => {
  const m = alarmStates([
    { projectId: 'a', level: 1, status: 2, end: 0, ts: 0 },
    { projectId: 'b', level: 1, status: 3, end: 0, ts: 0 },
  ])
  assert.equal(m.get('a').state, 'alarm')
  assert.equal(m.get('a').alarmCount, 1)
  assert.equal(m.get('b').state, 'normal')
})

test('弹窗行排序：告警 → 预警 → 在线正常（未知按在线）→ 离线垫底；同档按告警数、新建时间', () => {
  const act = [{ status: 1, end: 0 }]
  const ps = [
    { id: 'off-old', state: 'normal', online: false, created: '2024-01-01' },
    { id: 'off-new', state: 'normal', online: false, created: '2025-01-01' },
    { id: 'on', state: 'normal', online: true, created: '2023-01-01' },
    { id: 'unk', state: 'normal', online: null, created: '2024-06-01' },
    { id: 'warn-off', state: 'warning', online: false, created: '2020-01-01' },
    { id: 'alarm-off', state: 'alarm', online: false, alarms: act, created: '2020-01-01' },
    { id: 'alarm2', state: 'alarm', online: true, alarms: [...act, ...act], created: '2019-01-01' },
  ]
  assert.deepEqual([...ps].sort(byProjectPriority).map((p) => p.id), ['alarm2', 'alarm-off', 'warn-off', 'unk', 'on', 'off-new', 'off-old'])
  // 分组弹窗：进行中告警优先，其余同上
  const g = [...ps, { id: 'warn-act', state: 'warning', online: true, alarms: act, created: '2018-01-01' }]
  assert.deepEqual(g.sort(byActiveFirst).map((p) => p.id), ['alarm2', 'alarm-off', 'warn-act', 'warn-off', 'unk', 'on', 'off-new', 'off-old'])
  assert.deepEqual(ps.map(isOffRow), [true, true, false, false, false, false, false])
})
