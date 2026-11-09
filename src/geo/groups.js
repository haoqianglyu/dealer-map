// 项目 → 小区分组（纯函数，便于测试）。分组 key = 地理编码范围 + 小区名；展示、汇总按所填区县。
// 候选（查询串 / 关键词成对）在组内合并：不再依赖「哪个项目排在前面」。
// 规则：与小区名同名的候选放第一（失败缓存 key 用它，不随项目顺序变），其余按出现次数、字典序。
const pairKey = (q, kw) => `${q}\u0000${kw || ''}`

export function buildGroups(projects) {
  const m = new Map()
  for (const p of projects) {
    const key = p.community ? `${p.geoDistrict || p.city}|${p.community}` : `#${p.id}`
    let g = m.get(key)
    if (!g) {
      g = { key, community: p.community, vague: p.vague, geoCity: p.geoCity, city: p.city, cityName: p.cityName, district: p.geoDistrict, areaDistrict: p.district, districtName: p.districtName, count: 0, area: 0, types: new Set(), latest: '', projects: [], queries: [], keywords: [], legacy: null, _pairs: new Map() }
      m.set(key, g)
    }
    for (const [i, q] of (p.queries || []).entries()) {
      const k = pairKey(q, p.keywords?.[i])
      const hit = g._pairs.get(k)
      if (hit) hit.n++
      else g._pairs.set(k, { q, kw: p.keywords?.[i], n: 1 })
    }
    if (p.legacy) {
      const seen = new Map((g.legacy?.queries || []).map((q, i) => [q, g.legacy.keywords?.[i]]))
      p.legacy.queries.forEach((q, i) => seen.has(q) || seen.set(q, p.legacy.keywords?.[i]))
      g.legacy = { scope: p.legacy.scope, queries: [...seen.keys()], keywords: [...seen.values()] }
    }
    g.count++
    g.projects.push(p)
    g.area += p.area
    g.types.add(p.type)
    if (p.created > g.latest) g.latest = p.created
  }
  for (const g of m.values()) {
    const pairs = [...g._pairs.values()].sort((a, b) => (b.kw === g.community) - (a.kw === g.community) || b.n - a.n || a.q.localeCompare(b.q, 'zh'))
    g.queries = pairs.map((x) => x.q)
    g.keywords = pairs.map((x) => x.kw)
    delete g._pairs
  }
  return [...m.values()]
}
