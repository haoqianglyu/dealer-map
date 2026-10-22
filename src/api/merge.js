// 分页 / 重复加载时按项目 id 合并：已有的不再追加（并发翻页、重试、重叠的两次加载都不会把项目数翻倍）
export function mergeProjects(current, list, seen, map = (p) => p) {
  for (const p of current) seen.add(String(p.id))
  const add = []
  for (const raw of list || []) {
    const id = String(raw?.id ?? '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    add.push(map(raw))
  }
  return add.length ? current.concat(add) : current
}
