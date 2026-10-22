import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isActiveAlarm, alarmTag, alarmStates } from '../src/geo/states.js'

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
