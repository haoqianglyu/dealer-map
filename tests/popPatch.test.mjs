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
