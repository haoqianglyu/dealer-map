<template>
  <div ref="el" class="amap" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, onActivated, nextTick } from 'vue'
import { createWarmLights } from './warmLights'
import { showName } from '@/utils/showroom'
import { mountMarquee, alarmText } from '@/directives/marquee'
import CONTEXT_CITIES from '@/data/cities-context.json'
import { STATES, stateRank, worstState, alarmCount, hasNewAlarm, levelState, isActiveAlarm, NOTICE_COLOR } from '@/geo/states'
import { buildIndexes, query, membersOf, expansionZoom, layoutLabels, circleSize, circleFont, zoomClusterFor, levelFor as levelAt, byPriority, ZOOM_TERMINAL, textWidth, mainMass, leafIndex, anyLeafKey, queryZoom, DOT_SIZE } from '@/geo/cluster'
import { fmtNumber } from '@/utils/format'

// 高德地图：自定义 HTML 标记 + 暖光热力。标记四个层级（docs/fable-clustering.md）：
//   ① 区县（z < zoomCluster()，≈ 城市视野再放大一级）：每区一个汇总圈，数 = 该区全部项目（含未定位）；
//   ② 街区簇（< 14）：屏幕 64 px 内的小区合并成一个圈，圈下只写「k 小区」（不写地名）；
//   ③ 小区（14–16）：胶囊带小区名，48 px 内仍合并（「A 等 k 小区」）；
//   ④ 终态（≥ 16）：按 16 级查询，同坐标 / 分期的小区永远合并，点击出分组弹窗。
// 底图只用一个内置深色样式（两种模式共用）。地名按级别分工，同一地名只画一份：
//   ① 级：高德只留底色 + 道路，地名全由我们画（城市名、邻近城市名、区县气泡名）；
//   ② 级起：高德画全部注记（区县 / 道路 / POI），我们只画数字、「k 小区」、告警角标和胶囊里的小区名
const props = defineProps({
  AMap: { type: Object, required: true },
  communities: { type: Array, default: () => [] },
  districts: { type: Array, default: () => [] },
  cityLabels: { type: Array, default: () => [] }, // [{ key, name, lnglat }]
  mode: { type: String, default: 'markers' }, // markers | heat
  heatMetric: { type: String, default: 'projects' },
  center: { type: Array, default: null },
  focus: { type: Object, default: null }, // { key, n }：飞到该小区并打开弹窗
  fit: { type: Object, default: null }, // { points, n }：适配视野到这些点
  avoid: { type: Object, default: () => ({ top: 96, right: 420, bottom: 90, left: 24 }) }, // 被界面占用的屏幕边距（px）
  scale: { type: Number, default: 1 }, // 界面缩放：标记 / 弹窗只放大不缩小（2560 下与界面同比例）
})
const emit = defineEmits(['open-project', 'district-tap', 'ready'])

const MAP_STYLE = 'amap://styles/darkblue' // 老板要藏青底色（dark 是灰色）；darkblue 在 13–16 级路名较少，暂接受
const el = ref(null)
let map = null
let heat = null
let info = null
let recs = new Map() // 标记 id → { marker, html, tap }（按 id 增量更新，不变的标记不动）
let labels = []
let indexes = null // 聚合索引（communities 变化时重建，防抖 300 ms）
let idxTimer = 0
let lastBox = null // 最近一次查询的范围（视野四边各外扩 15%）：平移不出这个范围就不重查
let lastItems = []
let fitZoom = null // 最近一次城市适配的缩放级别：区县 → 簇 的分界随它走
let level = null
let pop = null // { c, all, open: Set<projectId> }
let readySent = false
const ready = () => {
  if (readySent) return
  readySent = true
  emit('ready')
}
const k = () => Math.max(1, props.scale)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const zoomCluster = () => zoomClusterFor(fitZoom)
const levelFor = (z) => levelAt(z, zoomCluster())

// 每个可点标记外包一个 ≥ 44 px 的透明点按区（遥控 / 触摸），圆的视觉尺寸不变
const hitBox = (inner) => `<div class="dm-hit">${inner}</div>`
const badgeHtml = (alarms) => (alarms ? `<span class="dm-mk__badge">${fmtNumber(alarms)} 告警</span>` : '')

// ① 区县汇总圈
const districtSize = (d) => Math.max(44, Math.min(88, 36 + Math.sqrt(d.projects.length) * 6))
// 远景（1350 屏城市视野 ≈ 9.9 级）中心城区几个区县圈会互压：按屏幕距离算一个统一缩小系数（0.65–1），
// 让最近的两圈之间留 8 px；只缩圆不缩字
function districtFit(ds) {
  if (!map || ds.length < 2) return 1
  const pts = ds.map((d) => {
    const p = map.lngLatToContainer(d.lnglat)
    return [p.x, p.y, (districtSize(d) * k()) / 2]
  })
  let f = 1
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dist = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
      f = Math.min(f, (dist - 8 * k()) / (pts[i][2] + pts[j][2]))
    }
  return Math.max(0.65, Math.min(1, f))
}
// 区县名放哪边：默认圈下；压到别的圈 / 角标时依次试 左 / 右 / 上（都压就仍放圈下）
const hitR = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
function districtLabelSides(ds, fit) {
  const K = k()
  const geo = ds.map((d) => {
    const p = map.lngLatToContainer(d.lnglat)
    const r = (Math.max(36, Math.round(districtSize(d) * fit)) * K) / 2
    const total = alarmCount(d.projects)
    const unloc = alarmCount(d.unlocatedProjects || [])
    const bw = total ? (textWidth(unloc ? '4 个未定位' : `${total} 告警`, unloc ? 11 : 12) + 14) * K : 0
    const bh = (unloc ? 34 : 20) * K
    const badge = total ? { l: p.x + r - 12 * K, r: p.x + r - 12 * K + bw, t: p.y - r - (unloc ? 24 : 9) * K, b: p.y - r - (unloc ? 24 : 9) * K + bh } : null
    return { x: p.x, y: p.y, r, badge, w: textWidth(d.label, 13) * K + 4, h: 18 * K }
  })
  const blocks = geo.flatMap((g, i) => [{ i, l: g.x - g.r, r: g.x + g.r, t: g.y - g.r, b: g.y + g.r }, ...(g.badge ? [{ i, ...g.badge }] : [])])
  const candOf = (g) => {
    const gap = 5 * K
    return {
      below: { l: g.x - g.w / 2, r: g.x + g.w / 2, t: g.y + g.r + gap, b: g.y + g.r + gap + g.h },
      left: { l: g.x - g.r - gap - g.w, r: g.x - g.r - gap, t: g.y - g.h / 2, b: g.y + g.h / 2 },
      right: { l: g.x + g.r + gap, r: g.x + g.r + gap + g.w, t: g.y - g.h / 2, b: g.y + g.h / 2 },
      above: { l: g.x - g.w / 2, r: g.x + g.w / 2, t: g.y - g.r - gap - g.h, b: g.y - g.r - gap },
    }
  }
  const free = (i, side, rect, placed) => !blocks.some((b) => b.i !== i && hitR(rect, b)) && !placed.some((p) => hitR(rect, p)) && !(side === 'right' && geo[i].badge && hitR(rect, geo[i].badge))
  // 第一轮：圈下就放得下的先占位；第二轮：其余的依次试 左 / 右 / 上（也避开已放的名字）
  const out = geo.map(() => null)
  const placed = []
  geo.forEach((g, i) => {
    const r = candOf(g).below
    if (free(i, 'below', r, [])) {
      out[i] = 'below'
      placed.push(r)
    }
  })
  geo.forEach((g, i) => {
    if (out[i]) return
    const c = candOf(g)
    const side = ['left', 'right', 'above'].find((sd) => free(i, sd, c[sd], placed)) || 'below'
    out[i] = side
    placed.push(c[side])
  })
  return out
}
function districtHtml(d, fit = 1, side = 'below') {
  const count = d.projects.length
  const state = worstState(d.projects)
  const size = Math.max(36, Math.round(districtSize(d) * fit))
  const cls = ['dm-mk', `dm-mk--${state}`, 'dm-mk--district', count >= 1000 ? 'dm-mk--big' : '', hasNewAlarm(d.projects) ? 'dm-mk--pulse' : ''].join(' ')
  // 告警里有一部分在未定位的小区（放大后地图上找不到）：角标第二行写明「1 个未定位」/「均未定位」（两行窄角标，
  // 不比单行宽多少，远景区县圈挤在一起时不横向压到邻圈）；入口在告警列表（点区县会滚到那条并闪一下）
  const total = alarmCount(d.projects)
  const unloc = alarmCount(d.unlocatedProjects || [])
  const badge = total && unloc ? `<span class="dm-mk__badge dm-mk__badge--2">${fmtNumber(total)} 告警<em>${total === unloc ? '均' : `${fmtNumber(unloc)} 个`}未定位</em></span>` : badgeHtml(total)
  return hitBox(`<div class="${cls}" style="--size:${size}px;--c:${STATES[state].color}">
    <span class="dm-mk__n">${fmtNumber(count)}</span>${badge}
    <span class="dm-mk__label${side !== 'below' ? ` dm-mk__label--${side}` : ''}">${esc(d.label)}</span>
  </div>`)
}
// ②③④ 簇 / 小区：lay = layoutLabels 的结果 { named, label, sub }
function itemHtml(it, lay) {
  if (lay.dot) {
    // 被更高优先级的胶囊 / 圈压住：小点，无数字 / 角标（点击仍是它自己）
    return hitBox(`<div class="dm-mk dm-mk--dot dm-mk--${it.state}" style="--size:${DOT_SIZE}px;--c:${STATES[it.state].color}"></div>`)
  }
  const S = circleSize(it.n)
  const cls = ['dm-mk', `dm-mk--${it.state}`, lay.named ? 'dm-mk--named' : '', it.k > 1 ? 'dm-mk--cluster' : '', it.pulse ? 'dm-mk--pulse' : ''].join(' ')
  const label = lay.named
    ? `<span class="dm-mk__label">${esc(lay.label)}${lay.sub ? `<small>${esc(lay.sub)}</small>` : ''}</span>`
    : lay.side
      ? `<span class="dm-mk__label dm-mk__label--side dm-mk__label--${lay.side}">${esc(lay.label)}${lay.sub ? `<small>${esc(lay.sub)}</small>` : ''}</span>`
      : lay.label
        ? `<span class="dm-mk__label dm-mk__label--sub">${esc(lay.label)}</span>`
        : ''
  return hitBox(`<div class="${cls}" style="--size:${S}px;--fs:${circleFont(S)}px;--c:${STATES[it.state].color}">
    <span class="dm-mk__n">${fmtNumber(it.n)}</span>${badgeHtml(it.alarms)}${label}
  </div>`)
}

const z2 = (n) => String(n).padStart(2, '0')
const fmtTs = (ms) => {
  const d = new Date(ms)
  return `${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}`
}
// 某项目的告警：有进行中告警的项目默认展开（最多 3 行 +「更多」），只有已处理 / 已恢复历史的默认折叠成一行摘要；
// 每行 时间 与「1级」固定，中间内容放不下时跑马灯（与右侧告警列表相同）
const AL_FIRST = 3
const AL_MAX = 20
function alarmRows(p, open, more) {
  const list = p.alarms || []
  if (!list.length) return ''
  const active = list.filter(isActiveAlarm).length
  const l1 = list.filter((a) => a.level === 1).length
  const head = `<li class="al al--sum${active ? ' on' : ''}" data-act="al" data-pid="${esc(p.id)}" role="button" tabindex="0" aria-expanded="${open}">
    <i style="background:${active ? STATES.alarm.color : NOTICE_COLOR}"></i>
    <span class="n">${l1 ? `${l1} 条一级告警` : `${list.length} 条告警`}${active ? `（进行中 ${active}）` : ''} · 最近 ${fmtTs(list[0].ts)}</span>
    <span class="a">${open ? '▾' : '▸'}</span></li>`
  if (!open) return head
  const sorted = [...list].sort((a, b) => isActiveAlarm(b) - isActiveAlarm(a) || b.ts - a.ts)
  const shown = sorted.slice(0, more ? AL_MAX : AL_FIRST)
  const rest = sorted.length - shown.length
  return (
    head +
    shown
      .map((a) => {
        const st = levelState(a.level)
        const color = st === 'notice' ? NOTICE_COLOR : STATES[st].color
        const tag = isActiveAlarm(a) ? '' : a.status === 1 ? '（已恢复）' : '（已处理）'
        return `<li class="al al--row${isActiveAlarm(a) ? ' on' : ''}"><i style="background:${color}"></i><span class="t">${fmtTs(a.ts)}</span>
        <span class="n mqx"><span>${esc(alarmText(a.device, a.content))}${tag}</span></span><span class="a">${a.level}级</span></li>`
      })
      .join('') +
    (rest > 0
      ? more
        ? `<li class="al al--more al--note">… 另 ${rest} 条（详情页查看全部）</li>`
        : `<li class="al al--more" data-act="more" data-pid="${esc(p.id)}" role="button" tabindex="0">更多 ${rest} 条 ▾</li>`
      : '')
  )
}

const POP_LIMIT = 5
const GROUP_FIRST = 3
const hasActive = (p) => (p.alarms || []).some(isActiveAlarm)
const byProjectPriority = (a, b) =>
  stateRank(b.state) - stateRank(a.state) || (b.alarms?.length || 0) - (a.alarms?.length || 0) || String(b.created).localeCompare(String(a.created))
const byActiveFirst = (a, b) => hasActive(b) - hasActive(a) || byProjectPriority(a, b)
// 小区摘要（分组弹窗排序用）
const commSummary = (g) => ({ rank: stateRank(worstState(g.projects)), alarms: alarmCount(g.projects), n: g.projects.length })
function popoverHtml() {
  const { c, all, toggled, more: moreSet } = pop
  const row = (p, label) => `<li class="pj"><i style="background:${STATES[p.state]?.color || STATES.normal.color}" title="${STATES[p.state]?.label || ''}"></i>
        <span class="n">${esc(showName(p.name) || label)}</span><span class="a">${p.area ? `${p.area}㎡` : ''}</span><a class="go" data-pid="${esc(p.id)}" role="button" tabindex="0" title="查看项目详情">详情 ›</a></li>${alarmRows(p, (p.alarms || []).some(isActiveAlarm) !== toggled.has(p.id), moreSet.has(p.id))}`
  let rows
  let grouped = false
  if (c.groups) {
    // 终态簇：按小区分组，每个小区一个组头，不会有整个小区被藏在「前 5 行」后面。
    // 组顺序：聚焦的小区 → 有进行中告警的 → 状态 → 告警 → 项目数；组内进行中告警的项目在前。
    // 每组默认最多 GROUP_FIRST 行（进行中告警的项目总是全部露出），其余收进本组的「更多 n 个项目」
    grouped = true
    const gs = [...c.groups].sort(
      (a, b) => (b.key === c.focusKey) - (a.key === c.focusKey) || b.projects.some(hasActive) - a.projects.some(hasActive) || byPriority(commSummary(a), commSummary(b))
    )
    rows = gs
      .map((g) => {
        const ps = [...g.projects].sort(byActiveFirst)
        const nAct = ps.filter(hasActive).length
        const open = pop.gopen.has(g.key) || gs.length === 1
        const shown = open ? ps : ps.slice(0, Math.max(GROUP_FIRST, nAct))
        const rest = ps.length - shown.length
        const al = alarmCount(g.projects)
        return (
          `<li class="grp"><span class="n">${esc(g.label)}</span><span class="a">${g.projects.length} 个项目${al ? ` · <em>${al} 告警</em>` : ''}</span></li>` +
          shown.map((p) => row(p, g.label)).join('') +
          (rest > 0 ? `<li class="al al--more grp-more" data-act="gmore" data-g="${esc(g.key)}" role="button" tabindex="0">更多 ${rest} 个项目 ▾</li>` : '')
        )
      })
      .join('')
  } else {
    const sorted = [...c.projects].sort(byProjectPriority)
    rows = (all ? sorted : sorted.slice(0, POP_LIMIT)).map((p) => row(p, c.label)).join('')
  }
  const total = c.projects.length
  const more = !grouped && !all && total > POP_LIMIT ? `<button class="dm-pop__all" data-act="all">查看全部 ${total} 个项目</button>` : ''
  const alarms = alarmCount(c.projects)
  return `<div class="dm-pop">
    <div class="dm-pop__h"><b>${esc(c.label)}</b><span>${esc(c.districtName)} · ${c.projects.length} 个项目${alarms ? ` · <em>${alarms} 告警</em>` : ''}</span>
      <button class="dm-pop__x" data-act="close" aria-label="关闭">×</button></div>
    <ul>${rows}</ul>${more}
    <i class="dm-pop__arrow"></i>
  </div>`
}

let popMq = [] // 弹窗内跑马灯的清理函数（每次重绘 / 关闭时清掉）
function clearPopMq() {
  popMq.forEach((f) => f())
  popMq = []
}
function openPopover(c, keep = false) {
  if (!keep || !pop || pop.c.key !== c.key) pop = { c, all: false, toggled: new Set(), more: new Set(), gopen: new Set(c.focusKey ? [c.focusKey] : []) }
  clearPopMq()
  info.setContent(popoverHtml())
  info.open(map, c.lnglat)
  nextTick(() =>
    requestAnimationFrame(() => {
      avoidUi() // 展开告警 / 更多后弹窗变高，再检查一次是否被界面挡住
      el.value?.querySelectorAll('.dm-pop .mqx').forEach((n) => popMq.push(mountMarquee(n)))
    })
  )
}
// 指针在弹窗上：滚轮 / 触控板捏合 / 触摸滑动只滚弹窗内容，不缩放、不拖动地图
const inPop = (t) => Boolean(t && t.closest && t.closest('.dm-pop'))
function onPopWheel(e) {
  if (!inPop(e.target)) return
  e.stopPropagation()
  if (e.ctrlKey) e.preventDefault() // 触控板捏合 = ctrl + wheel：既不缩放地图也不缩放页面
}
function onPopTouch(e) {
  if (inPop(e.target)) e.stopPropagation()
  else onMoveGuard(e)
}
function onPopOver(e) {
  if (inPop(e.target) && map) map.setStatus({ scrollWheel: false, dragEnable: false, doubleClickZoom: false })
}
function onPopOut(e) {
  if (inPop(e.target) && !inPop(e.relatedTarget) && map) map.setStatus({ scrollWheel: true, dragEnable: true, doubleClickZoom: true })
}
// 弹窗被顶栏 / 侧栏 / 图例挡住时平移地图：一次 ~250 ms 缓出，只平移刚好露出弹窗的距离（+12px 间隙）。
// 平移进行中再次检查（展开告警 / 更多后弹窗变高）时，以「这次平移的终点」为基准合并成同一段动画，不叠加、不二次漂移。
const PAN_MS = 250
let panGoal = null // { ll, until }：进行中的快速平移的目标中心
let panRaf = 0
function goalShift() {
  if (!panGoal || performance.now() > panGoal.until) return [0, 0]
  const p = map.lngLatToContainer(panGoal.ll)
  const { width, height } = map.getSize()
  return [width / 2 - p.x, height / 2 - p.y] // 平移结束时屏幕内容还会再移动的距离
}
function stopPan() {
  cancelAnimationFrame(panRaf)
  panGoal = null
}
function quickPan(dx, dy) {
  const [sx, sy] = goalShift()
  const { width, height } = map.getSize()
  const ll = map.containerToLngLat(new props.AMap.Pixel(width / 2 - sx - dx, height / 2 - sy - dy))
  panGoal = { ll, until: performance.now() + PAN_MS + 60 }
  // 自己补间（高德 setCenter 的时长动画接近匀速）：ease-out cubic，每帧瞬时设中心
  const from = map.getCenter()
  const t0 = performance.now()
  cancelAnimationFrame(panRaf)
  const step = (t) => {
    if (!map) return
    const k = Math.min(1, (t - t0) / PAN_MS)
    const e = 1 - Math.pow(1 - k, 3)
    map.setCenter([from.lng + (ll.lng - from.lng) * e, from.lat + (ll.lat - from.lat) * e], true)
    if (k < 1) panRaf = requestAnimationFrame(step)
  }
  panRaf = requestAnimationFrame(step)
}
function avoidUi() {
  const p = el.value?.querySelector('.dm-pop')
  if (!p || !map) return
  // 弹窗有 0.16 s 的放大入场动画（transform 以底边中点为原点）：用布局尺寸还原最终矩形，避免少平移几像素
  const b = p.getBoundingClientRect()
  const [sx, sy] = goalShift()
  const cx = (b.left + b.right) / 2 + sx
  const bottom = b.bottom + sy
  const r = { left: cx - p.offsetWidth / 2, right: cx + p.offsetWidth / 2, top: bottom - p.offsetHeight, bottom }
  const box = el.value.getBoundingClientRect()
  const a = props.avoid
  let dx = 0
  let dy = 0
  if (r.right > box.right - a.right) dx = box.right - a.right - r.right - 12
  if (r.left + dx < box.left + a.left) dx = box.left + a.left - r.left + 12
  // 顶边至少 108 px（顶栏渐变 96 px + 12 px 间隙；缩放 < 1 时 a.top 会小于 96，弹窗会贴到时钟）
  const top = Math.max(a.top, 96) + 12
  if (r.top < box.top + top) dy = box.top + top - r.top
  else if (r.bottom > box.bottom - a.bottom) dy = box.bottom - a.bottom - r.bottom - 12
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) quickPan(dx, dy)
}

// [上, 右, 下, 左] 视野留白（避开界面）
const padding = (extra = 40) => [props.avoid.top + extra, props.avoid.right + extra, props.avoid.bottom + extra, props.avoid.left + extra]

function boundsOf(points) {
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return new props.AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)])
}
// 适配视野（允许小数级缩放；高德 setBounds 会向下取整一级，城市视图显得过远）
function fitBounds(bounds, pad, city = false) {
  // 自己算：高德 setBounds / getFitZoomAndCenterByBounds 在大留白时会多缩小一级且不居中
  stopPan() // 新的适配 / 区县放大优先：停掉还没走完的弹窗避让平移，否则它会把中心拉回旧位置
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const [top, right, bottom, left] = pad
  const { width, height } = map.getSize()
  const w = Math.max(80, width - left - right)
  const h = Math.max(80, height - top - bottom)
  const lat = (sw.lat + ne.lat) / 2
  const mPerDegLat = 111320
  const spanX = Math.max(1, (ne.lng - sw.lng) * mPerDegLat * Math.cos((lat * Math.PI) / 180))
  const spanY = Math.max(1, (ne.lat - sw.lat) * mPerDegLat)
  const res = Math.max(spanX / w, spanY / h, 2) // 米/像素
  const zoom = Math.min(17, Math.max(3, Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / res)))
  if (city) fitZoom = zoom
  map.setZoomAndCenter(zoom, [(sw.lng + ne.lng) / 2, lat], true)
  map.panBy((right - left) / -2, (bottom - top) / -2)
}

// 点击区县：缩放到该区小区的「主体」范围（至少到簇级）
// 先只留区县中心附近的小区（个别小区按名称前缀在全市范围定位），再丢掉离主体很远的离群点（mainMass：
// > 3 × 中位距离 + 5–95 分位外框），视野不会被一两个远点拉得偏到一侧；离群点平移仍可到达
function zoomTo(points, center) {
  stopPan()
  if (center) {
    const near = points.filter((p) => Math.abs(p[0] - center[0]) < 0.35 && Math.abs(p[1] - center[1]) < 0.3)
    if (near.length) points = near
  }
  points = mainMass(points)
  if (!points?.length) {
    // 该区还没有已定位的小区：放大到簇级的区县中心（至少有反馈）
    if (center) map.setZoomAndCenter(Math.max(map.getZoom(), zoomCluster() + 0.5), center, false, 350)
    return
  }
  if (points.length === 1) {
    map.setZoomAndCenter(15, points[0], false, 600)
    return
  }
  fitBounds(boundsOf(points), padding(60))
  if (map.getZoom() < zoomCluster()) map.setZoom(zoomCluster(), true)
}
// 点簇：放大到刚好拆开的级别（一段 350 ms 动画），并让出侧栏（目标中心向右偏半个侧栏宽）
function zoomInto(ll, z) {
  stopPan()
  info.close()
  const dx = (props.avoid.right - props.avoid.left) / 2
  const degPerPx = 360 / (256 * Math.pow(2, z))
  map.setZoomAndCenter(z, [ll[0] + dx * degPerPx, ll[1]], false, 350)
}
// 视野中心向左让出侧栏
function centerOn(c) {
  map.setCenter(c, true)
  map.panBy(-(props.avoid.right - props.avoid.left) / 2, 0)
}

function clear(list) {
  if (list.length) map.remove(list)
  return []
}

// 远景地名：城市名（点位/热力都画）；热力模式下区县名 + 数量（暖色）
function renderLabels() {
  labels = clear(labels)
  if (level !== 'district') return
  const { AMap } = props
  // 城市名只画在附近没有区县气泡的城市（有气泡的城市由区县名说明位置，避免压字）
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.2 && Math.abs(a[1] - b[1]) < 0.15
  const { width } = map.getSize()
  const inUi = (ll) => {
    const p = map.lngLatToContainer(ll)
    return p.y < props.avoid.top || p.x > width - props.avoid.right
  }
  // 有项目的城市 + 长三角邻近城市（静态表，补远景方位感）；同名只画一次
  const seen = new Set()
  const all = [...props.cityLabels, ...CONTEXT_CITIES.map(([name, lng, lat]) => ({ key: name, name: `${name}市`, lnglat: [lng, lat], ctx: true }))]
  labels = all
    .filter((c) => {
      const n = c.name.replace(/市$/, '')
      if (seen.has(n)) return false
      seen.add(n)
      return !props.districts.some((d) => near(d.lnglat, c.lnglat)) && !inUi(c.lnglat)
    })
    .map((c) => new AMap.Marker({ position: c.lnglat, anchor: 'center', content: `<div class="dm-city${c.ctx ? ' dm-city--ctx' : ''}">${esc(c.name)}</div>`, zIndex: 100, bubble: true, clickable: false }))
  if (props.mode === 'heat') {
    const metric = props.heatMetric
    for (const d of props.districts) {
      const n = metric === 'alarms' ? d.projects.reduce((s, p) => s + (p.alarms || []).filter((a) => a.level === 1).length, 0) : d.projects.length
      if (!n) continue
      labels.push(
        new AMap.Marker({
          position: d.lnglat,
          anchor: 'top-center',
          offset: new AMap.Pixel(0, 14),
          content: `<div class="dm-hlabel">${esc(d.label)} <b>${n}</b></div>`,
          zIndex: 105,
          bubble: true,
          clickable: false,
        })
      )
    }
  }
  map.add(labels)
}

// 标记点击：不用高德 Marker 的 'click' 事件，改用标记 DOM 上的原生 click。
// 根因（区县气泡「点了没反应」）：高德在按下→抬起之间指针移动 ≥ ~3px 时把这次操作当成拖动地图（地图也跟着挪了几像素），
// 不再派发 Marker 'click'。真人用鼠标 / 触控板 / 手指 / 电视遥控点击几乎都会抖动几个像素，于是放大不触发；
// 自动化测试的合成点击按下抬起坐标完全相同，所以一直测不出来。浏览器原生 click 只要按下抬起在同一元素上就会触发
// （触屏轻点在触摸容差内也会合成 click），这里再用按下点到抬起点的距离区分「点」和「拖」（> TAP_SLOP 视为拖动地图，不触发）。
// 聚合（cluster）分支重写标记时请保留这一做法。
const TAP_SLOP = 12 // px（屏幕像素）
let downAt = null // 最近一次 pointerdown 的屏幕坐标（onPopDown 捕获阶段记录）
function tappable(html, onTap) {
  const box = document.createElement('div')
  box.innerHTML = html.trim()
  const node = box.firstElementChild
  node.addEventListener('click', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > TAP_SLOP * k()) return
    e.stopPropagation()
    onTap()
  })
  return node
}

// 拆分 / 合并动画（§6）。只动 Marker content 根节点（.dm-hit）的 transform / opacity（合成层，不触发布局）；
// 高德用外层 .amap-marker 定位，互不干扰。Web Animations API：不需要「先设初值、下一帧清零」的强制回流。
//   拆分（放大）：新项从父项的屏幕位置平移到自身位置，240 ms，透明度 0→1
//   合并（缩小）：新项 scale .7→1，160 ms；旧项原地淡出 120 ms（不做汇聚位移，镜头本身在动）
//   prefers-reduced-motion：只做 120 ms 淡入淡出
//   同级平移新进入视野的项：120 ms 淡入；数据刷新（同视野）不动画
const SPLIT_MS = 240
const MERGE_MS = 160
const FADE_MS = 120
const EASE = 'cubic-bezier(.2,.7,.2,1)'
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
let fading = new Set() // 正在淡出、稍后移除的旧标记
function enter(node, kind, from) {
  if (!node || !node.animate || !kind) return
  if (reducedMotion() || kind === 'fade') return node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' })
  if (kind === 'split' && from) {
    node.animate([{ transform: `translate(${from[0]}px,${from[1]}px) scale(.6)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: SPLIT_MS, easing: EASE })
  } else if (kind === 'merge' || kind === 'split') {
    node.animate([{ transform: 'scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MERGE_MS, easing: EASE })
  }
}
function leave(rs, animate) {
  const ms = rs.map((r) => r.marker)
  if (!ms.length) return
  if (!animate) return map.remove(ms)
  for (const r of rs) {
    const n = r.node
    if (!n || !n.animate) {
      map.remove(r.marker)
      continue
    }
    n.style.pointerEvents = 'none'
    // 角标 / 名字立即隐去，只有圆淡出：拆分时不会同屏出现两份「1 告警」
    for (const t of n.querySelectorAll('.dm-mk__badge, .dm-mk__label')) t.style.visibility = 'hidden'
    r.marker.setzIndex(110) // 退场的压在新项下面
    fading.add(r.marker)
    n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
      if (!fading.delete(r.marker) || !map) return
      map.remove(r.marker)
    }
  }
}

// 按 id 增量同步标记：html 不变的不动（平移 / 告警刷新时不闪），变了的 setContent，消失的移除。
// anim = { kind: 'split' | 'merge' | 'fade', from(s) → [dx, dy] | null }：新出现的项做入场，消失的项淡出
function syncMarkers(list, anim = null) {
  const { AMap } = props
  const next = new Map()
  const add = []
  const entering = []
  for (const s of list) {
    let r = recs.get(s.id)
    if (r) {
      recs.delete(s.id)
      r.tap = s.tap
      // 同 id 换了位置（区县中心在数据加载完后从「第一个已定位小区」换成行政中心、小区坐标被纠正）：跟着挪
      if (!r.ll || r.ll[0] !== s.lnglat[0] || r.ll[1] !== s.lnglat[1]) r.marker.setPosition(s.lnglat)
      r.ll = s.lnglat
      if (r.html !== s.html) {
        r.html = s.html
        r.node = tappable(s.html, () => r.tap())
        r.marker.setContent(r.node)
        r.marker.setzIndex(s.z)
      }
    } else {
      r = { html: s.html, tap: s.tap, ll: s.lnglat }
      r.node = tappable(s.html, () => r.tap())
      r.marker = new AMap.Marker({ position: s.lnglat, anchor: 'center', content: r.node, zIndex: s.z })
      add.push(r.marker)
      if (anim) entering.push([r.node, s])
    }
    next.set(s.id, r)
  }
  leave([...recs.values()], Boolean(anim))
  if (add.length) map.add(add)
  // 只给视野内的新项做动画（外扩区的项看不见，省掉 WAAPI 和父项查找）
  const { width, height } = entering.length ? map.getSize() : { width: 0, height: 0 }
  for (const [node, s] of entering) {
    const p = s.it ? { x: s.it.x, y: s.it.y } : map.lngLatToContainer(s.lnglat)
    if (p.x < -60 || p.y < -60 || p.x > width + 60 || p.y > height + 60) continue
    enter(node, anim.kind, anim.from ? anim.from(s) : null)
  }
  recs = next
  if (next.size) requestAnimationFrame(ready)
}

// 查询范围：视野四边各外扩 15%（平移时少闪；5k 点时外扩越大每次要建的 DOM 越多）
function viewBox(grow = 0.15) {
  const b = map.getBounds()
  const sw = b.getSouthWest()
  const ne = b.getNorthEast()
  const dx = (ne.lng - sw.lng) * grow
  const dy = (ne.lat - sw.lat) * grow
  return [sw.lng - dx, sw.lat - dy, ne.lng + dx, ne.lat + dy]
}
const inside = (a, b) => b && a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3]

// 开发压测：localStorage.dmStress = 5000 → 在真实小区周围抖动复制到 N 个点（验证 5k 点下的流畅度）；生产构建不含
function stressed(list) {
  const n = (import.meta.env.DEV && Number(localStorage.getItem('dmStress'))) || 0
  if (!n || !list.length) return list
  const out = [...list]
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
  for (let i = 0; out.length < n; i++) {
    const c = list[i % list.length]
    out.push({ ...c, key: `${c.key}~${i}`, lnglat: [c.lnglat[0] + rnd() * 0.12, c.lnglat[1] + rnd() * 0.1] })
  }
  return out
}
function rebuildIndexes() {
  indexes = buildIndexes(stressed(props.communities), k())
  lastBox = null
}

// 点击簇 / 小区（§5）：可拆的簇放大；终态簇（16 级仍合并）出分组弹窗；单小区出弹窗
function onItemTap(it) {
  if (it.clusterId == null) return openPopover(indexes.byKey.get(it.key))
  const ez = expansionZoom(it)
  if (ez <= ZOOM_TERMINAL) return zoomInto(it.lnglat, ez)
  openGroup(it)
}
function openGroup(it, focusKey = null) {
  const members = membersOf(indexes, it)
  const dists = [...new Set(members.map((m) => m.districtName).filter(Boolean))]
  // 兜底：同名的成员（归一化没能合并的同一个小区）并成一组，组头不会出现两个「湖玺庄园」
  const byLabel = new Map()
  for (const m of members) {
    const g = byLabel.get(m.label)
    if (!g) byLabel.set(m.label, { ...m, projects: [...m.projects] })
    else {
      g.projects.push(...m.projects)
      if (m.key === focusKey) g.key = focusKey
    }
  }
  const groups = [...byLabel.values()]
  openPopover({
    key: it.id,
    lnglat: it.lnglat,
    label: groups.length > 1 ? `${it.top} 等 ${groups.length} 小区` : groups[0]?.label || it.top,
    districtName: dists.join(' / '),
    projects: members.flatMap((m) => m.projects),
    groups,
    focusKey,
  })
}

// 上一帧的视图（决定动画方向）：{ level, zq, items }
let lastView = { level: null, zq: null, items: [] }
// 新项的父项屏幕偏移（相对自身）：放大时从父项位置飞出
function parentFrom(prev, nextLevel) {
  if (prev.level === 'district') {
    const byName = new Map(props.districts.map((d) => [d.label, d.lnglat]))
    return (s) => {
      const ll = s.it && byName.get(String(s.it.dists || '').split('|')[0])
      return ll ? offsetTo(ll, s.lnglat) : null
    }
  }
  if (nextLevel === 'district' || !prev.items.length) return null
  let leaves = null // 懒建：只在真有新项时遍历一次上一帧的成员（≤ 5k）
  return (s) => {
    if (!s.it) return null
    leaves = leaves || leafIndex(prev.items)
    const par = leaves.get(anyLeafKey(s.it))
    return par ? offsetTo(par.lnglat, s.lnglat) : null
  }
}
function offsetTo(fromLL, toLL) {
  const a = map.lngLatToContainer(fromLL)
  const b = map.lngLatToContainer(toLL)
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy) < 2 ? null : [dx, dy]
}
// 层级 / 级别变化 → 动画方向：放大 = split，缩小 = merge，同级平移 = fade
const RANK = { district: 0, cluster: 1, named: 2, terminal: 2 }
function animFor(prev, nextLevel, zq, animate) {
  if (!animate || prev.level == null) return null
  const a = RANK[prev.level] * 100 + (prev.zq ?? 0)
  const b = RANK[nextLevel] * 100 + (zq ?? 0)
  if (b > a) return { kind: 'split', from: parentFrom(prev, nextLevel) }
  if (b < a) return { kind: 'merge' }
  return { kind: 'fade' }
}

// animate = false：数据刷新 / 模式切换（同视野重画，不做入场动画）
function renderMarkers(animate = true) {
  if (!map) return
  const t0 = performance.now()
  if (props.mode === 'heat') {
    lastItems = []
    lastView = { level: null, zq: null, items: [] }
    return syncMarkers([])
  }
  if (level === 'district') {
    lastItems = []
    const anim = animFor(lastView, 'district', null, animate)
    lastView = { level: 'district', zq: null, items: [] }
    const fit = districtFit(props.districts)
    const sides = districtLabelSides(props.districts, fit)
    return syncMarkers(
      props.districts.map((d, i) => ({
        id: `d:${d.key}`,
        lnglat: d.lnglat,
        html: districtHtml(d, fit, sides[i]),
        z: 120 + stateRank(worstState(d.projects)),
        tap: () => {
          zoomTo(d.points, d.lnglat)
          emit('district-tap', { key: d.key, label: d.label, unlocatedAlarms: alarmCount(d.unlocatedProjects || []) })
        },
      })),
      anim
    )
  }
  if (!indexes) rebuildIndexes()
  lastBox = viewBox()
  const z = map.getZoom()
  const zq = level === 'cluster' ? Math.min(13, queryZoom(z)) : queryZoom(z)
  const items = query(indexes, level, lastBox, z)
  for (const it of items) {
    const p = map.lngLatToContainer(it.lnglat)
    it.x = p.x
    it.y = p.y
  }
  const lay = layoutLabels(items, level, k())
  const t1 = performance.now()
  const anim = animFor(lastView, level, zq, animate)
  lastItems = items
  lastView = { level, zq, items }
  syncMarkers(
    items.map((it) => ({
      id: it.id,
      it,
      lnglat: it.lnglat,
      html: itemHtml(it, lay.get(it.id)),
      z: lay.get(it.id).dot ? 112 : 120 + it.rank * 2 + (it.k > 1 ? 1 : 0),
      tap: () => onItemTap(it),
    })),
    anim
  )
  if (import.meta.env.DEV) window.__dmPerf = { ms: +(performance.now() - t0).toFixed(1), layout: +(t1 - t0).toFixed(1), items: items.length, anim: anim?.kind || null }
}

// 底图要素：远景只留底色 + 道路（地名由我们画，避免同名两份）；≥ 12 级加建筑与注记（区县 / 道路 / POI 名，由高德画）
let featuresNow = ''
function applyFeatures() {
  const f = level === 'district' ? ['bg', 'road'] : ['bg', 'road', 'building', 'point']
  if (f.join() === featuresNow) return
  featuresNow = f.join()
  map.setFeatures(f)
}

function renderHeat() {
  const on = props.mode === 'heat'
  const lights = props.communities
    .map((c) => {
      if (props.heatMetric === 'alarms') {
        const list = c.projects.flatMap((p) => p.alarms || []).filter((a) => a.level === 1)
        const active = list.filter(isActiveAlarm).length
        return { lnglat: c.lnglat, count: list.length, pulse: active > 0, label: active || '' }
      }
      return { lnglat: c.lnglat, count: c.projects.length, pulse: false }
    })
    .filter((l) => l.count > 0)
  heat.set(lights, props.heatMetric === 'alarms' ? 'red' : 'gold')
  heat.show(on)
}

function render(animate = true) {
  if (!map) return
  renderMarkers(animate)
  renderLabels()
  renderHeat()
}

function onZoom() {
  const next = levelFor(map.getZoom())
  if (next !== level) {
    const crossedSplit = (next === 'district') !== (level === 'district')
    level = next
    if (crossedSplit) info.close()
    applyFeatures()
    renderLabels()
  }
  renderMarkers() // 簇随整数级别变化、标签避让随像素距离变化：每次缩放结束都重算（按 id 增量，不变的不动）
}
function onMove() {
  if (level === 'district') return renderLabels()
  if (!inside(viewBox(0), lastBox)) renderMarkers()
}

// 在标记上按下后、移动还没超过 TAP_SLOP 时，把移动事件挡在高德之前（捕获阶段）：
// 否则高德把这次抖动的点按当成一次几像素的拖动，抬起后（我们已经缩放到新视野）再按旧级别的锚点把地图平移回去，
// 一下推出好几公里（实测点滨湖区落到惠山）。超过 TAP_SLOP 就放行 → 从标记上开始拖地图照常可用。
let downOnMarker = false
function onMoveGuard(e) {
  if (!downOnMarker || !downAt) return
  const t = e.touches ? e.touches[0] : e
  if (Math.hypot(t.clientX - downAt[0], t.clientY - downAt[1]) <= TAP_SLOP * k()) e.stopPropagation()
  else downOnMarker = false
}
const endGuard = () => (downOnMarker = false)

// × 用 pointerdown 直接关闭（捕获阶段，高德 InfoWindow 内部吞掉 click 时也可靠）
function onPopDown(e) {
  downAt = [e.clientX, e.clientY]
  downOnMarker = Boolean(e.target.closest && e.target.closest('.dm-hit'))
  // 用户开始拖动 / 点地图：停掉进行中的快速平移，不与手势抢视野
  if (!inPop(e.target)) stopPan()
  const t = e.target.closest && e.target.closest('[data-act="close"]')
  if (!t) return
  e.stopPropagation()
  e.preventDefault()
  info && info.close()
}
// 遥控 / 键盘：Enter 触发弹窗里的按钮（告警摘要、更多、详情）
function onPopKey(e) {
  if (e.key !== 'Enter' || !inPop(e.target)) return
  const t = e.target.closest('[data-act],[data-pid]')
  if (t) {
    e.preventDefault()
    t.click()
  }
}
function onPopClick(e) {
  const t = e.target.closest && e.target.closest('[data-act],[data-pid]')
  if (!t) return
  const act = t.getAttribute('data-act')
  if (act === 'close') return info.close()
  if (act === 'all' && pop) {
    pop.all = true
    return openPopover(pop.c, true)
  }
  if (act === 'al' && pop) {
    const id = t.getAttribute('data-pid')
    pop.toggled.has(id) ? pop.toggled.delete(id) : pop.toggled.add(id)
    return openPopover(pop.c, true)
  }
  if (act === 'gmore' && pop) {
    pop.gopen.add(t.getAttribute('data-g'))
    return openPopover(pop.c, true)
  }
  if (act === 'more' && pop) {
    pop.more.add(t.getAttribute('data-pid'))
    return openPopover(pop.c, true)
  }
  if (t.classList.contains('go')) emit('open-project', t.getAttribute('data-pid'))
}

onMounted(() => {
  const { AMap } = props
  map = new AMap.Map(el.value, {
    viewMode: '2D',
    zoom: 10.5,
    center: props.center || undefined,
    mapStyle: MAP_STYLE,
  })
  if (import.meta.env.DEV) window.__dmMap = map // 开发环境：验证脚本读取缩放级别
  el.value.addEventListener('click', onPopClick)
  el.value.addEventListener('pointerdown', onPopDown, true)
  el.value.addEventListener('wheel', onPopWheel, { capture: true, passive: false })
  el.value.addEventListener('touchmove', onPopTouch, { capture: true, passive: true })
  el.value.addEventListener('pointerover', onPopOver, true)
  for (const t of ['mousemove', 'pointermove']) el.value.addEventListener(t, onMoveGuard, true)
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, endGuard, true)
  el.value.addEventListener('pointerout', onPopOut, true)
  el.value.addEventListener('keydown', onPopKey)
  map.addControl(new AMap.Scale()) // 位置 / 样式由下方 CSS 覆盖（左下、图例上方）
  if (props.center) centerOn(props.center)
  info = new AMap.InfoWindow({ isCustom: true, autoMove: false, offset: new AMap.Pixel(0, -22 * k()), anchor: 'bottom-center' })
  el.value.style.setProperty('--k', k())
  info.on('close', () => {
    pop = null
    clearPopMq()
    map && map.setStatus({ scrollWheel: true, dragEnable: true, doubleClickZoom: true })
  })
  heat = createWarmLights(AMap, map)
  if (props.fit?.points?.length) fitBounds(boundsOf(props.fit.points), padding(40), true) // 地图挂载前已算好的适配
  level = levelFor(map.getZoom())
  applyFeatures()
  rebuildIndexes()
  map.on('zoomend', onZoom)
  map.on('moveend', onMove)
  map.on('click', () => info.close())
  // 底图 complete / 首批标记画出 / 1.2 s 兜底：三者最早者收起首屏罩
  map.on('complete', ready)
  setTimeout(ready, 1200)
  render()
})

// 地理编码是渐进的：数据变化后防抖 300 ms 重建索引再重画（不在缩放事件里重建）
watch(
  () => [props.communities, props.districts, props.cityLabels],
  () => {
    clearTimeout(idxTimer)
    idxTimer = setTimeout(() => {
      if (!map) return
      rebuildIndexes()
      render(false)
    }, 300)
  }
)
watch(
  () => [props.mode, props.heatMetric],
  () => {
    info && info.close()
    applyFeatures()
    render(false)
  }
)
// 告警聚焦：直接到最细一级（16），找到包含该小区的项（单小区或终态簇），打开它的弹窗
function focusCommunity(key) {
  const c = props.communities.find((x) => x.key === key)
  if (!c || !map || props.mode === 'heat') return
  if (!indexes || !indexes.byKey.has(key)) rebuildIndexes()
  stopPan()
  map.setZoomAndCenter(Math.max(ZOOM_TERMINAL, map.getZoom()), c.lnglat, true)
  onZoom()
  const it = lastItems.find((i) => i.key === key) || lastItems.find((i) => i.clusterId != null && membersOf(indexes, i).some((m) => m.key === key))
  const at = it ? it.lnglat : c.lnglat
  // 一步到位（不再慢慢平移让出侧栏）：之后若弹窗仍被挡，avoidUi 只做一次 250 ms 的快速平移
  map.setCenter(at, true)
  const { width, height } = map.getSize()
  map.setCenter(map.containerToLngLat(new props.AMap.Pixel(width / 2 + (props.avoid.right - props.avoid.left) / 2, height / 2)), true)
  onMove()
  if (it && it.clusterId != null) openGroup(it, key)
  else openPopover(c)
}
watch(
  () => props.focus,
  (f) => f && focusCommunity(f.key)
)
watch(
  () => props.scale,
  () => {
    if (!el.value) return
    el.value.style.setProperty('--k', k())
    info && info.setOffset && info.setOffset(new props.AMap.Pixel(0, -22 * k()))
    if (map) {
      rebuildIndexes() // 半径随界面缩放
      renderMarkers()
    }
  }
)
watch(
  () => props.fit,
  (f) => {
    if (!f || !map || !f.points?.length) return
    info.close()
    fitBounds(boundsOf(f.points), padding(40), true)
    onZoom() // 分界随城市视野变了：即使缩放级别没变也重判层级
  }
)

// keep-alive：回到地图页时让高德重新量一次容器，关掉旧弹窗
onActivated(() =>
  nextTick(() => {
    info && info.close()
    map && typeof map.resize === 'function' && map.resize()
  })
)

onBeforeUnmount(() => {
  cancelAnimationFrame(panRaf)
  clearTimeout(idxTimer)
  if (map) {
    heat && heat.destroy()
    map.off('zoomend', onZoom)
    el.value && el.value.removeEventListener('click', onPopClick)
    el.value && el.value.removeEventListener('pointerdown', onPopDown, true)
    el.value && el.value.removeEventListener('wheel', onPopWheel, true)
    el.value && el.value.removeEventListener('touchmove', onPopTouch, true)
    el.value && el.value.removeEventListener('pointerover', onPopOver, true)
    for (const t of ['mousemove', 'pointermove']) el.value && el.value.removeEventListener(t, onMoveGuard, true)
    for (const t of ['pointerup', 'pointercancel']) window.removeEventListener(t, endGuard, true)
    el.value && el.value.removeEventListener('pointerout', onPopOut, true)
    el.value && el.value.removeEventListener('keydown', onPopKey)
    clearPopMq()
    map.destroy()
  }
  map = heat = info = indexes = null
  fading = new Set()
  recs = new Map()
  lastItems = []
  labels = []
})
</script>

<style scoped>
.amap {
  width: 100%;
  height: 100%;
}
</style>

<style>
/* 瓦片到位前不要白底网格 */
.amap,
.amap .amap-container,
.amap .amap-maps {
  background: #06101f !important;
}
/* 比例尺：左下、图例上方，随主题（无白底） */
.amap .amap-scalecontrol {
  top: auto !important;
  left: 24px !important;
  bottom: var(--dm-scale-bottom, 90px) !important;
  background: transparent !important;
}
.amap .amap-scale-text {
  font: 11px var(--dm-num) !important;
  color: #8fb0d0 !important;
  text-shadow: 0 0 4px #040b18;
}
.amap .amap-scale-line,
.amap .amap-scale-edgeleft,
.amap .amap-scale-edgeright,
.amap .amap-scale-middle {
  border-color: rgba(216, 236, 255, 0.6) !important;
  background: rgba(216, 236, 255, 0.6) !important;
}

.dm-hit {
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: calc(44px * var(--k, 1));
  min-height: calc(44px * var(--k, 1));
  cursor: pointer;
}
.dm-mk {
  position: relative;
  width: calc(var(--size) * var(--k, 1));
  height: calc(var(--size) * var(--k, 1));
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: calc(2px * var(--k, 1)) solid var(--c);
  background: color-mix(in srgb, var(--c) 12%, rgba(4, 11, 24, 0.55));
  box-shadow: inset 0 0 calc(18px * var(--k, 1)) color-mix(in srgb, var(--c) 28%, transparent);
  cursor: pointer;
  transition: transform 0.12s ease;
}
.dm-hit:hover .dm-mk {
  transform: scale(1.06);
}
.dm-hit:hover .dm-mk__label {
  color: #fff;
}
.dm-mk__n {
  font: 600 calc(13px * var(--k, 1))/1 var(--dm-num);
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.dm-mk:not(.dm-mk--district):not(.dm-mk--named) .dm-mk__n {
  font-size: calc(var(--fs, 13px) * var(--k, 1));
}
.dm-mk--district .dm-mk__n {
  font-size: calc(20px * var(--k, 1));
}
.dm-mk--district.dm-mk--big .dm-mk__n {
  font-size: calc(16px * var(--k, 1));
}
/* 多小区合并：外圈一道细叠环（区别于「一个小区多个项目」） */
.dm-mk--cluster::before {
  content: '';
  position: absolute;
  inset: calc(-5px * var(--k, 1));
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  pointer-events: none;
}
.dm-mk--named.dm-mk--cluster::before {
  border-radius: 999px;
}
.dm-mk__badge {
  position: absolute;
  top: -9px;
  left: calc(100% - calc(12px * var(--k, 1)));
  height: calc(20px * var(--k, 1));
  padding: 0 calc(7px * var(--k, 1));
  font: 600 calc(12px * var(--k, 1))/calc(20px * var(--k, 1)) var(--dm-font);
  color: #fff;
  white-space: nowrap;
  background: #ff4d4f;
  border-radius: calc(10px * var(--k, 1));
  box-shadow: 0 calc(2px * var(--k, 1)) calc(6px * var(--k, 1)) rgba(0, 0, 0, 0.4);
}
.dm-mk__badge--2 {
  top: calc(-24px * var(--k, 1));
  height: auto;
  padding: calc(2px * var(--k, 1)) calc(7px * var(--k, 1)) calc(3px * var(--k, 1));
  line-height: calc(16px * var(--k, 1));
  text-align: center;
}
.dm-mk__badge em {
  display: block;
  font-style: normal;
  font-weight: 500;
  font-size: calc(11px * var(--k, 1));
  line-height: calc(13px * var(--k, 1));
  color: #ffe6b3;
}
.dm-mk:not(.dm-mk--district) .dm-mk__badge {
  top: -8px;
  height: calc(18px * var(--k, 1));
  padding: 0 calc(6px * var(--k, 1));
  font-size: calc(11px * var(--k, 1));
  line-height: calc(18px * var(--k, 1));
}
.dm-mk__label {
  position: absolute;
  top: calc(100% + calc(5px * var(--k, 1)));
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: calc(13px * var(--k, 1));
  color: #d8ecff;
  paint-order: stroke;
  -webkit-text-stroke: calc(3px * var(--k, 1)) rgba(4, 11, 24, 0.9);
}
.dm-mk--district .dm-mk__label--left,
.dm-mk--district .dm-mk__label--right {
  top: 50%;
  left: auto;
  right: calc(100% + calc(5px * var(--k, 1)));
  transform: translateY(-50%);
}
.dm-mk--district .dm-mk__label--right {
  right: auto;
  left: calc(100% + calc(5px * var(--k, 1)));
}
.dm-mk--district .dm-mk__label--above {
  top: auto;
  bottom: calc(100% + calc(5px * var(--k, 1)));
}
.dm-mk:not(.dm-mk--district) .dm-mk__label {
  font-size: calc(12px * var(--k, 1));
  color: #b7d3f0;
}
/* 名字外挂：胶囊放不下时圆不动、名字放在圆右 / 左 / 下 / 上（与区县名同一套） */
.dm-mk .dm-mk__label--side {
  font-size: calc(13px * var(--k, 1));
  color: #e8f4ff;
}
.dm-mk .dm-mk__label--side small {
  margin-left: calc(4px * var(--k, 1));
  font-size: calc(11px * var(--k, 1));
  color: #9fc0e0;
}
.dm-mk .dm-mk__label--right,
.dm-mk .dm-mk__label--left {
  top: 50%;
  left: calc(100% + calc(5px * var(--k, 1)));
  transform: translateY(-50%);
}
.dm-mk .dm-mk__label--left {
  left: auto;
  right: calc(100% + calc(5px * var(--k, 1)));
}
.dm-mk .dm-mk__label--above {
  top: auto;
  bottom: calc(100% + calc(5px * var(--k, 1)));
}
.dm-mk--dot {
  border-width: calc(2px * var(--k, 1));
  background: color-mix(in srgb, var(--c) 45%, rgba(4, 11, 24, 0.7));
  box-shadow: none;
}
.dm-mk .dm-mk__label--sub {
  top: calc(100% + calc(3px * var(--k, 1)));
  font-size: calc(11px * var(--k, 1));
  color: #9fc0e0;
  pointer-events: none;
}
.dm-mk--cluster .dm-mk__label--sub {
  top: calc(100% + calc(7px * var(--k, 1)));
}
.dm-mk--named .dm-mk__label small {
  margin-left: calc(4px * var(--k, 1));
  font-size: calc(11px * var(--k, 1));
  color: #9fc0e0;
}
.dm-mk--pulse::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: calc(2px * var(--k, 1)) solid var(--c);
  animation: dm-pulse 2.4s ease-out infinite;
}
@keyframes dm-pulse {
  from {
    transform: scale(1);
    opacity: 0.9;
  }
  to {
    transform: scale(2.2);
    opacity: 0;
  }
}
.dm-mk--named {
  width: auto;
  min-width: calc(var(--size) * var(--k, 1));
  gap: calc(6px * var(--k, 1));
  padding: 0 calc(10px * var(--k, 1)) 0 calc(4px * var(--k, 1));
  border-radius: 999px;
  justify-content: flex-start;
}
.dm-mk--named .dm-mk__n {
  min-width: calc((var(--size) - 12px) * var(--k, 1));
  text-align: center;
}
.dm-mk--named.dm-mk--pulse::after {
  border-radius: 999px;
}
.dm-mk--named .dm-mk__label,
.dm-mk:not(.dm-mk--district).dm-mk--named .dm-mk__label {
  position: static;
  transform: none;
  font-size: calc(13px * var(--k, 1));
  color: #e8f4ff;
  -webkit-text-stroke: 0;
}
.dm-city--ctx {
  color: #56708f;
}
.dm-city {
  font-size: calc(14px * var(--k, 1));
  font-weight: 500;
  letter-spacing: calc(2px * var(--k, 1));
  color: #6f8fb8;
  white-space: nowrap;
  pointer-events: none;
  paint-order: stroke;
  -webkit-text-stroke: calc(3px * var(--k, 1)) rgba(4, 11, 24, 0.85);
}
.dm-hlabel {
  font-size: calc(12px * var(--k, 1));
  color: #ffde9e;
  white-space: nowrap;
  pointer-events: none;
  paint-order: stroke;
  -webkit-text-stroke: calc(3px * var(--k, 1)) rgba(10, 8, 4, 0.85);
}
.dm-hlabel b {
  font: 600 calc(13px * var(--k, 1)) var(--dm-num);
}

/* ---------- 小区弹窗 ---------- */
.dm-pop {
  position: relative;
  user-select: none; /* 行 / 组头 / 「更多」都是点按目标 */
  -webkit-user-select: none;
  width: calc(360px * var(--k, 1));
  font-size: calc(13px * var(--k, 1));
  color: #d8ecff;
  background: rgba(6, 16, 36, 0.97);
  border: 1px solid rgba(120, 170, 255, 0.2);
  border-radius: calc(10px * var(--k, 1));
  box-shadow: 0 calc(16px * var(--k, 1)) calc(40px * var(--k, 1)) rgba(0, 0, 0, 0.5);
  animation: dm-pop-in 0.16s ease-out;
  transform-origin: 50% 100%;
}
@keyframes dm-pop-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
.dm-pop__arrow {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: calc(12px * var(--k, 1));
  height: calc(12px * var(--k, 1));
  background: rgba(6, 16, 36, 0.97);
  border-right: 1px solid rgba(120, 170, 255, 0.2);
  border-bottom: 1px solid rgba(120, 170, 255, 0.2);
  transform: translateX(-50%) rotate(45deg);
}
.dm-pop__h {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: calc(3px * var(--k, 1));
  padding: calc(12px * var(--k, 1)) calc(40px * var(--k, 1)) calc(10px * var(--k, 1)) calc(14px * var(--k, 1));
  border-bottom: 1px solid rgba(120, 170, 255, 0.1);
}
.dm-pop__h b {
  font-size: calc(16px * var(--k, 1));
  font-weight: 600;
  color: #f2f7ff;
}
.dm-pop__h span {
  font-size: calc(12px * var(--k, 1));
  color: #8fb0d0;
}
.dm-pop__h em {
  font-style: normal;
  color: #ff6b6b;
}
.dm-pop__x {
  position: absolute;
  top: calc(4px * var(--k, 1));
  right: calc(4px * var(--k, 1));
  width: calc(40px * var(--k, 1));
  height: calc(40px * var(--k, 1));
  font-size: calc(18px * var(--k, 1));
  line-height: 1;
  color: #8fb0d0;
  background: none;
  border: 0;
  border-radius: calc(6px * var(--k, 1));
  cursor: pointer;
}
.dm-pop__x:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.dm-pop ul {
  max-height: calc(300px * var(--k, 1));
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: calc(4px * var(--k, 1)) 0;
}
.dm-pop li.pj {
  display: grid;
  grid-template-columns: calc(8px * var(--k, 1)) 1fr auto auto;
  align-items: center;
  gap: calc(10px * var(--k, 1));
  min-height: calc(40px * var(--k, 1));
  padding: 0 calc(4px * var(--k, 1)) 0 calc(14px * var(--k, 1));
}
.dm-pop li i {
  width: calc(8px * var(--k, 1));
  height: calc(8px * var(--k, 1));
  border-radius: 50%;
}
.dm-pop li .n {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dm-pop li .a {
  color: #8fb0d0;
  font-family: var(--dm-num);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.dm-pop .go {
  display: inline-flex;
  align-items: center;
  min-height: calc(40px * var(--k, 1));
  padding: 0 calc(10px * var(--k, 1));
  color: #35d4ff;
  cursor: pointer;
  white-space: nowrap;
  border-radius: calc(6px * var(--k, 1));
}
.dm-pop .go:focus-visible,
.dm-pop li.al--sum:focus-visible,
.dm-pop li.al--more:focus-visible {
  outline: 2px solid #35d4ff;
  outline-offset: -2px;
}
.dm-pop li.al .n.mq {
  text-overflow: clip;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 14px), transparent);
  mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 14px), transparent);
}
.dm-pop li.al .n.mq > span {
  display: inline-block;
  padding-left: 4px;
  will-change: transform;
}
.dm-pop .go:hover {
  text-decoration: underline;
}
.dm-pop li.al {
  display: grid;
  grid-template-columns: calc(6px * var(--k, 1)) auto 1fr auto;
  align-items: center;
  gap: calc(6px * var(--k, 1));
  padding: calc(3px * var(--k, 1)) calc(14px * var(--k, 1)) calc(3px * var(--k, 1)) calc(32px * var(--k, 1));
  font-size: calc(12px * var(--k, 1));
  color: #8fb0d0;
}
.dm-pop li.al i {
  width: calc(6px * var(--k, 1));
  height: calc(6px * var(--k, 1));
}
.dm-pop li.al--sum {
  grid-template-columns: calc(6px * var(--k, 1)) 1fr auto;
  min-height: calc(40px * var(--k, 1));
  cursor: pointer;
  border-radius: calc(4px * var(--k, 1));
}
.dm-pop li.al--sum:hover {
  background: rgba(53, 212, 255, 0.06);
}
.dm-pop li.al.on {
  color: #ffd2d2;
}
.dm-pop li.al .t {
  font-family: var(--dm-num);
  color: #8fb0d0;
}
.dm-pop li.al--more {
  display: flex;
  align-items: center;
  min-height: calc(40px * var(--k, 1));
  color: #35d4ff;
  cursor: pointer;
}
.dm-pop li.grp {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(10px * var(--k, 1));
  min-height: calc(28px * var(--k, 1));
  padding: 0 calc(14px * var(--k, 1));
  font-size: calc(12px * var(--k, 1));
  color: #8fb0d0;
  background: rgba(120, 170, 255, 0.05);
}
.dm-pop li.grp .n {
  color: #b7d3f0;
}
.dm-pop li.grp {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #0c1b35;
}
.dm-pop li.grp em {
  font-style: normal;
  color: #ff6b6b;
}
.dm-pop li.grp-more {
  padding-left: calc(32px * var(--k, 1));
}
.dm-pop li.al--note {
  min-height: calc(28px * var(--k, 1));
  color: #8fb0d0;
  cursor: default;
}
.dm-pop__all {
  display: block;
  width: calc(100% - calc(28px * var(--k, 1)));
  margin: 0 calc(14px * var(--k, 1)) calc(12px * var(--k, 1));
  height: calc(40px * var(--k, 1));
  font: inherit;
  font-size: calc(12px * var(--k, 1));
  color: #35d4ff;
  background: rgba(53, 212, 255, 0.06);
  border: 1px solid rgba(53, 212, 255, 0.25);
  border-radius: calc(6px * var(--k, 1));
  cursor: pointer;
}
.dm-pop__all:hover {
  background: rgba(53, 212, 255, 0.12);
}
</style>
