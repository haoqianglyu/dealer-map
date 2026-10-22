// 两次重叠的全量加载（旧的一次未取消、页序打乱、重复页）合并结果仍是唯一项目数
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeProjects } from '../src/api/merge.js'

test('重叠加载 / 重复页按 id 去重，仍是 702', () => {
  const all = Array.from({ length: 702 }, (_, i) => ({ id: `p${i}` }))
  const pages = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
  const a = pages(all, 100), b = pages([...all].reverse(), 100)
  let list = []
  const seen = new Set()
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) list = mergeProjects(list, a[i], seen)
    if (b[i]) list = mergeProjects(list, b[i], seen)
    if (a[i]) list = mergeProjects(list, a[i], seen) // 重试同一页
  }
  assert.equal(list.length, 702)
  assert.equal(new Set(list.map((p) => p.id)).size, 702)
  // 数字 / 字符串 id 视为同一个
  assert.equal(mergeProjects([{ id: 1 }], [{ id: '1' }, { id: 2 }], new Set()).length, 2)
})
