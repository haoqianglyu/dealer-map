import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAlarmTracker, retryDelay, STALE_MS, EXPIRE_MS } from '../src/geo/alarmPoll.js'

const clock = () => {
  let t = 1_000_000
  return { now: () => t, step: (ms) => (t += ms) }
}

test('失败 1 次不清数据：沿用旧列表 + stale', () => {
  const c = clock()
  const tr = createAlarmTracker({ now: c.now })
  const list = [{ id: 1 }, { id: 2 }]
  tr.ok(list)
  const okAt = c.now()
  c.step(60000)
  const v = tr.fail(undefined)
  assert.equal(v.alarms, list)
  assert.equal(v.okAt, okAt)
  assert.equal(v.staleSince, c.now())
  assert.equal(v.error, '')
})

test('5 分钟起 aged（仍沿用，角标不掉）；满 30 分钟仍失败 → 清空 + 明确错误态（不是「正常」）', () => {
  const c = clock()
  const tr = createAlarmTracker({ now: c.now })
  tr.ok([{ id: 1 }])
  c.step(60000)
  tr.fail()
  c.step(STALE_MS - 60001)
  assert.deepEqual([tr.current().alarms.length, tr.current().aged], [1, false])
  c.step(1)
  assert.deepEqual([tr.current().alarms.length, tr.current().aged, tr.current().error], [1, true, ''])
  c.step(EXPIRE_MS - STALE_MS - 1)
  assert.equal(tr.current().alarms.length, 1)
  c.step(1)
  const v = tr.current()
  assert.equal(v.alarms.length, 0)
  assert.equal(v.error, 'expired')
  assert.equal(v.aged, false)
  assert.ok(v.okAt > 0, '保留最后成功时间用于「自 hh:mm 起无法更新」')
})

test('成功后 stale / 错误归零', () => {
  const c = clock()
  const tr = createAlarmTracker({ now: c.now })
  tr.ok([{ id: 1 }])
  c.step(EXPIRE_MS + 1)
  tr.fail()
  assert.equal(tr.current().error, 'expired')
  const v = tr.ok([{ id: 3 }])
  assert.deepEqual([v.staleSince, v.error, v.fails, v.alarms.length], [0, '', 0, 1])
})

test('403 立即清空；从未成功过 → failed', () => {
  const c = clock()
  const tr = createAlarmTracker({ now: c.now })
  assert.equal(tr.fail().error, 'failed')
  tr.ok([{ id: 1 }])
  const v = tr.fail(403)
  assert.equal(v.alarms.length, 0)
  assert.equal(v.error, 'forbidden')
})

test('未过期时 current() 不改变状态', () => {
  const c = clock()
  const tr = createAlarmTracker({ now: c.now })
  tr.ok([{ id: 1 }])
  c.step(EXPIRE_MS * 2) // 一直成功、只是没再轮询：不算过期（没有失败）
  assert.equal(tr.current().error, '')
})

test('重试退避 10 → 20 → 40 → 60 s 封顶', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryDelay), [10000, 20000, 40000, 60000, 60000, 60000])
})
