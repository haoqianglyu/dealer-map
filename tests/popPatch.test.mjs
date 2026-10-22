import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowPatch, focusKey } from '../src/geo/popPatch.js'

test('内容不变 → 不动任何行', () => assert.deepEqual(rowPatch(['a', 'b'], ['a', 'b']), []))
test('只换变了的行；多出的追加；少了的从后往前删', () => {
  assert.deepEqual(rowPatch(['a', 'b', 'c'], ['a', 'B', 'c']), [{ op: 'replace', i: 1 }])
  assert.deepEqual(rowPatch(['a'], ['a', 'b', 'c']), [{ op: 'append', i: 1 }, { op: 'append', i: 2 }])
  assert.deepEqual(rowPatch(['a', 'b', 'c'], ['x']), [{ op: 'replace', i: 0 }, { op: 'remove', i: 2 }, { op: 'remove', i: 1 }])
})
test('焦点身份：按 data-act / data-pid / data-g + class', () => {
  const n = (attrs, className) => ({ className, getAttribute: (a) => attrs[a] ?? null })
  assert.equal(focusKey(n({ 'data-pid': '7' }, 'go')), focusKey(n({ 'data-pid': '7' }, 'go')))
  assert.notEqual(focusKey(n({ 'data-pid': '7' }, 'go')), focusKey(n({ 'data-pid': '8' }, 'go')))
  assert.equal(focusKey(null), '')
})

test('焦点身份不含随状态变化的 class（告警恢复后摘要行去掉 on 仍是同一个按钮）', () => {
  const n = (attrs, className) => ({ className, getAttribute: (a) => attrs[a] ?? null })
  assert.equal(focusKey(n({ 'data-act': 'al', 'data-pid': '7' }, 'al al--sum on')), focusKey(n({ 'data-act': 'al', 'data-pid': '7' }, 'al al--sum')))
  assert.notEqual(focusKey(n({ 'data-pid': '7' }, 'go')), focusKey(n({ 'data-act': 'al', 'data-pid': '7' }, 'al')))
})
