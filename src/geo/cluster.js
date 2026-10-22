// 地图中间层级：按屏幕像素距离聚合小区（docs/fable-clustering.md §2–§4）
//   ② 街区簇：zoomCluster() ≤ z < 14，半径 64 px（× 界面缩放 k）
//   ③ 小区：14 ≤ z < 16，半径 48 px，仍靠得太近的小区合并成一个胶囊
//   ④ 终态：z ≥ 16 按 16 级查询，同坐标 / 分期的小区永远是一个簇（点击出分组弹窗）
// 纯函数（不依赖高德），便于单测；AmapView 负责投影与 DOM。
import Supercluster from 'supercluster'
import { STATES, stateRank, worstState, alarmCount, hasNewAlarm } from './states.js'

export const ZOOM_NAMED = 14
export const ZOOM_TERMINAL = 16
const RADIUS_CLUSTER = 64
const RADIUS_NAMED = 48

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// 区县 → 街区簇 的分界随屏幕走：城市视野（fitZoom）再放大约一级进入簇级
export const zoomClusterFor = (fitZoom) => clamp((fitZoom ?? 10.7) + 0.8, 10.8, 11.8)

export function levelFor(z, zc) {
  if (z < zc) return 'district'
  if (z < ZOOM_NAMED) return 'cluster'
  if (z < ZOOM_TERMINAL) return 'named'
  return 'terminal'
}
// 查询用的整数级别：小数级别向下取整（圈只会更疏不会更密），封顶 16
export const queryZoom = (z) => Math.min(ZOOM_TERMINAL, Math.floor(z))

// 圈直径（CSS px，未乘 k）：n = 项目数
export const circleSize = (n) => clamp(22 + 5.5 * Math.sqrt(n), 28, 64)
export const circleFont = (S) => (S < 36 ? 13 : S < 44 ? 14 : S < 56 ? 15 : 16)

const RANK_STATE = Object.fromEntries(Object.entries(STATES).map(([s, v]) => [v.rank, s]))
export const stateOfRank = (r) => RANK_STATE[r] || 'normal'

const common = {
  extent: 256, // 高德按 256 px 瓦片计 zoom：extent 256 时 radius 的单位就是高德屏幕像素
  minPoints: 2,
  map: (p) => ({ n: p.n, k: 1, rank: p.rank, alarms: p.alarms, pulse: p.pulse, top: p.name, topN: p.n, topRank: p.rank, dists: p.dist }),
  reduce: (acc, p) => {
    acc.n += p.n
    acc.k += p.k
    acc.alarms += p.alarms
    acc.pulse = acc.pulse || p.pulse
    // 名字取「最严重、其次项目最多」的成员（告警小区的名字优先露出）
    if (p.topRank > acc.topRank || (p.topRank === acc.topRank && p.topN > acc.topN)) {
      acc.top = p.top
      acc.topN = p.topN
      acc.topRank = p.topRank
    }
    acc.rank = Math.max(acc.rank, p.rank)
    if (p.dists) acc.dists = [...new Set(`${acc.dists || ''}|${p.dists}`.split('|').filter(Boolean))].join('|')
  },
}

// communities: [{ key, lnglat, label, districtName, projects }]
export function buildIndexes(communities, k = 1) {
  const byKey = new Map()
  const feats = []
  for (const c of communities) {
    if (!c.lnglat) continue
    byKey.set(c.key, c)
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lnglat[0], c.lnglat[1]] },
      properties: {
        key: c.key,
        name: c.label,
        n: c.projects.length,
        rank: stateRank(worstState(c.projects)),
        alarms: alarmCount(c.projects),
        pulse: hasNewAlarm(c.projects),
        dist: c.districtName || '',
      },
    })
  }
  const cluster = new Supercluster({ ...common, radius: RADIUS_CLUSTER * k, minZoom: 0, maxZoom: ZOOM_NAMED - 1 }).load(feats)
  const named = new Supercluster({ ...common, radius: RADIUS_NAMED * k, minZoom: ZOOM_NAMED, maxZoom: ZOOM_TERMINAL }).load(feats)
  return { cluster, named, byKey }
}

const r5 = (v) => v.toFixed(5)
// → [{ id, level, lnglat, n, k, rank, state, alarms, pulse, top, dists, clusterId?, key?, idx }]
export function query(indexes, level, bbox, z) {
  if (!indexes || level === 'district') return []
  const idx = level === 'cluster' ? indexes.cluster : indexes.named
  const zq = level === 'cluster' ? Math.min(ZOOM_NAMED - 1, queryZoom(z)) : queryZoom(z)
  const tier = level === 'cluster' ? 'c' : 'n'
  return idx.getClusters(bbox, zq).map((f) => {
    const p = f.properties
    const [lng, lat] = f.geometry.coordinates
    if (!p.cluster) {
      const c = indexes.byKey.get(p.key)
      return { id: `p:${p.key}`, level, lnglat: c.lnglat, n: p.n, k: 1, rank: p.rank, state: stateOfRank(p.rank), alarms: p.alarms, pulse: p.pulse, top: p.name, dists: p.dist, key: p.key, idx }
    }
    return { id: `${tier}:${zq}:${r5(lng)},${r5(lat)}`, level, lnglat: [lng, lat], n: p.n, k: p.k, rank: p.rank, state: stateOfRank(p.rank), alarms: p.alarms, pulse: p.pulse, top: p.top, dists: p.dists, clusterId: p.cluster_id, idx }
  })
}

// 簇的全部成员小区（community 对象）
export function membersOf(indexes, item) {
  if (item.key) return [indexes.byKey.get(item.key)].filter(Boolean)
  return item.idx
    .getLeaves(item.clusterId, Infinity)
    .map((f) => indexes.byKey.get(f.properties.key))
    .filter(Boolean)
}
// 点击簇：放大到刚好拆开的级别；> 16 = 终态（不再拆，出分组弹窗）
export const expansionZoom = (item) => (item.clusterId == null ? null : item.idx.getClusterExpansionZoom(item.clusterId))

// 排序优先级：状态 → 告警数 → 项目数
export const byPriority = (a, b) => b.rank - a.rank || b.alarms - a.alarms || b.n - a.n

// 估算文字宽度（px，未乘 k）：中日韩全角 1em，其余 0.6em
export function textWidth(s, size) {
  let w = 0
  for (const ch of String(s)) w += /[⺀-￿]/.test(ch) ? size : size * 0.6
  return w
}

const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
const grow = (r, d) => ({ l: r.l - d, r: r.r + d, t: r.t - d, b: r.b + d })

// 标签避让（§4.4）：items 已带屏幕坐标 x / y。返回每项的 { named, label }：
//   cluster 级：多小区簇在圈下标「k 小区」，撞到其它圈或已放的标签就不标；单小区不标
//   named / terminal 级：胶囊「n + 名字（+ 等 k 小区）」，撞到其它圈 / 胶囊 → 低优先级的退化为无名圆
//   同一屏不出现两份相同文字
export function layoutLabels(items, level, k = 1) {
  const out = new Map()
  const circ = new Map()
  for (const it of items) {
    const h = (circleSize(it.n) * k) / 2
    circ.set(it.id, { l: it.x - h, r: it.x + h, t: it.y - h, b: it.y + h })
  }
  const placed = []
  const seen = new Set()
  const pad = 4 * k
  const clear = (rect, selfId) => {
    const g = grow(rect, pad)
    for (const [id, c] of circ) if (id !== selfId && hit(g, c)) return false
    return !placed.some((p) => hit(g, p))
  }
  for (const it of [...items].sort(byPriority)) {
    const S = circleSize(it.n) * k
    if (level === 'cluster') {
      if (it.k < 2) {
        out.set(it.id, { named: false, label: '' })
        continue
      }
      const text = `${it.k} 小区`
      const w = textWidth(text, 11) * k
      const top = it.y + S / 2 + 3 * k
      const rect = { l: it.x - w / 2, r: it.x + w / 2, t: top, b: top + 14 * k }
      // 「k 小区」不是地名，允许重复
      if (clear(rect, it.id)) {
        placed.push(rect)
        out.set(it.id, { named: false, label: text })
      } else out.set(it.id, { named: false, label: '' })
      continue
    }
    const name = it.top || '未识别小区'
    const text = it.k > 1 ? `${name} 等 ${it.k} 小区` : name
    const numW = Math.max(S - 12 * k, textWidth(String(it.n), 13) * k)
    const w = 4 * k + numW + 6 * k + textWidth(name, 13) * k + (it.k > 1 ? (textWidth(` 等 ${it.k} 小区`, 11) + 4) * k : 0) + 10 * k + 8 * k // 右内边距 + 边框 4 + 字形余量 4
    const rect = { l: it.x - w / 2, r: it.x + w / 2, t: it.y - S / 2, b: it.y + S / 2 }
    if (!seen.has(text) && clear(rect, it.id)) {
      placed.push(rect)
      seen.add(text)
      out.set(it.id, { named: true, label: name, sub: it.k > 1 ? `等 ${it.k} 小区` : '' })
    } else out.set(it.id, { named: false, label: '' })
  }
  return out
}

// 点区县：只框住「主体」小区，丢掉远处的离群点（视野不被个别点拉偏 / 拉远；离群点平移仍可到达）
//   中心 = 经纬度中位数；丢掉离中心 > 3 × 中位距离的点（下限 ≈ 1.5 km，小区很集中时不误杀）；
//   点数 ≥ 20 时再按 5–95 分位裁一次外框（长尾方向不再把视野拖向一侧）
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const quantile = (s, q) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
export function mainMass(points) {
  if (!points || points.length < 4) return points || []
  const c = [median(points.map((p) => p[0])), median(points.map((p) => p[1]))]
  const cos = Math.cos((c[1] * Math.PI) / 180)
  const d = points.map((p) => Math.hypot((p[0] - c[0]) * cos, p[1] - c[1]))
  const lim = Math.max(3 * median(d), 0.0135)
  let kept = points.filter((_, i) => d[i] <= lim)
  if (kept.length >= 20) {
    const xs = kept.map((p) => p[0]).sort((a, b) => a - b)
    const ys = kept.map((p) => p[1]).sort((a, b) => a - b)
    const [x0, x1, y0, y1] = [quantile(xs, 0.05), quantile(xs, 0.95), quantile(ys, 0.05), quantile(ys, 0.95)]
    kept = kept.filter((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)
  }
  return kept.length >= 2 ? kept : points
}

// 拆分 / 合并动画的父项查找（§6）：上一帧每项 → 它包含的小区 key；新项任取一个成员 key 命中即为父
export function leafIndex(items) {
  const m = new Map()
  for (const it of items) {
    if (it.key) m.set(it.key, it)
    else if (it.clusterId != null) for (const f of it.idx.getLeaves(it.clusterId, Infinity)) m.set(f.properties.key, it)
  }
  return m
}
export function anyLeafKey(it) {
  if (it.key) return it.key
  const f = it.idx.getLeaves(it.clusterId, 1)[0]
  return f ? f.properties.key : null
}
