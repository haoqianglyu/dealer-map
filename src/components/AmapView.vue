<template>
  <div ref="el" class="amap" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, onActivated, nextTick } from 'vue'
import { createWarmLights } from './warmLights'
import { showName } from '@/utils/showroom'
import { STATES, stateRank, worstState, alarmCount, hasNewAlarm, levelState, isActiveAlarm, NOTICE_COLOR } from '@/geo/states'

// 高德地图：自定义 HTML 标记（每个小区一个，缩小时按区县汇总）+ 暖光热力
// 底图只用一个内置深色样式（两种模式共用）；远景（zoom < 12）隐藏底图全部地名/POI，地名由我们自己画（城市名 + 区县气泡名），避免同名出现两次
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
const emit = defineEmits(['open-project', 'ready'])

const ZOOM_SPLIT = 12 // < 12 区县汇总，≥ 12 小区
const ZOOM_NAMES = 14 // ≥ 14 小区标记下显示小区名
const MAP_STYLE = 'amap://styles/darkblue'
const el = ref(null)
let map = null
let heat = null
let info = null
let markers = []
let labels = []
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
const levelFor = (z) => (z < ZOOM_SPLIT ? 'district' : z < ZOOM_NAMES ? 'community' : 'named')

function markerHtml({ count, projects, district, label, named }) {
  const state = worstState(projects)
  const alarms = alarmCount(projects)
  const size = district ? Math.max(44, Math.min(88, 36 + Math.sqrt(count) * 6)) : Math.max(26, Math.min(40, 20 + Math.sqrt(count) * 5))
  const cls = ['dm-mk', `dm-mk--${state}`, district ? 'dm-mk--district' : '', hasNewAlarm(projects) ? 'dm-mk--pulse' : ''].join(' ')
  return `<div class="${cls}" style="--size:${size}px;--c:${STATES[state].color}">
    <span class="dm-mk__n">${count}</span>
    ${alarms ? `<span class="dm-mk__badge">${alarms} 告警</span>` : ''}
    ${district || named ? `<span class="dm-mk__label">${esc(label)}</span>` : ''}
  </div>`
}

const z2 = (n) => String(n).padStart(2, '0')
const fmtTs = (ms) => {
  const d = new Date(ms)
  return `${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}`
}
// 某项目的告警：默认折叠成一行摘要，点开再列（时间、设备、内容、等级；不含客户信息）
function alarmRows(p, open) {
  const list = p.alarms || []
  if (!list.length) return ''
  const active = list.filter(isActiveAlarm).length
  const l1 = list.filter((a) => a.level === 1).length
  const head = `<li class="al al--sum${active ? ' on' : ''}" data-act="al" data-pid="${esc(p.id)}" role="button" tabindex="0">
    <i style="background:${active ? STATES.alarm.color : NOTICE_COLOR}"></i>
    <span class="n">${l1 ? `${l1} 条一级告警` : `${list.length} 条告警`}${active ? `（进行中 ${active}）` : ''} · 最近 ${fmtTs(list[0].ts)}</span>
    <span class="a">${open ? '▾' : '▸'}</span></li>`
  if (!open) return head
  return (
    head +
    list
      .slice(0, 8)
      .map((a) => {
        const st = levelState(a.level)
        const color = st === 'notice' ? NOTICE_COLOR : STATES[st].color
        const tag = isActiveAlarm(a) ? '' : a.status === 1 ? '（已恢复）' : '（已处理）'
        return `<li class="al al--row${isActiveAlarm(a) ? ' on' : ''}"><i style="background:${color}"></i><span class="t">${fmtTs(a.ts)}</span>
        <span class="n">${esc(a.device)} · ${esc(a.content)}${tag}</span><span class="a">${a.level}级</span></li>`
      })
      .join('') +
    (list.length > 8 ? `<li class="al al--more">… 另 ${list.length - 8} 条</li>` : '')
  )
}

const POP_LIMIT = 5
function popoverHtml() {
  const { c, all, open } = pop
  const sorted = [...c.projects].sort(
    (a, b) => stateRank(b.state) - stateRank(a.state) || (b.alarms?.length || 0) - (a.alarms?.length || 0) || String(b.created).localeCompare(String(a.created))
  )
  const shown = all ? sorted : sorted.slice(0, POP_LIMIT)
  const rows = shown
    .map(
      (p) => `<li class="pj"><i style="background:${STATES[p.state]?.color || STATES.normal.color}" title="${STATES[p.state]?.label || ''}"></i>
        <span class="n">${esc(showName(p.name) || c.label)}</span><span class="a">${p.area ? `${p.area}㎡` : ''}</span><a class="go" data-pid="${esc(p.id)}" role="button" tabindex="0" title="查看项目详情">详情 ›</a></li>${alarmRows(p, open.has(p.id))}`
    )
    .join('')
  const more = !all && sorted.length > POP_LIMIT ? `<button class="dm-pop__all" data-act="all">查看全部 ${sorted.length} 个项目</button>` : ''
  const alarms = alarmCount(c.projects)
  return `<div class="dm-pop">
    <div class="dm-pop__h"><b>${esc(c.label)}</b><span>${esc(c.districtName)} · ${c.projects.length} 个项目${alarms ? ` · <em>${alarms} 告警</em>` : ''}</span>
      <button class="dm-pop__x" data-act="close" aria-label="关闭">×</button></div>
    <ul>${rows}</ul>${more}
    <i class="dm-pop__arrow"></i>
  </div>`
}

function openPopover(c, keep = false) {
  if (!keep || !pop || pop.c.key !== c.key) pop = { c, all: false, open: new Set() }
  info.setContent(popoverHtml())
  info.open(map, c.lnglat)
  nextTick(() => requestAnimationFrame(avoidUi))
}
// 弹窗被顶栏 / 侧栏 / 图例挡住时平移地图
function avoidUi() {
  const p = el.value?.querySelector('.dm-pop')
  if (!p || !map) return
  const r = p.getBoundingClientRect()
  const box = el.value.getBoundingClientRect()
  const a = props.avoid
  let dx = 0
  let dy = 0
  if (r.right > box.right - a.right) dx = box.right - a.right - r.right - 12
  if (r.left + dx < box.left + a.left) dx = box.left + a.left - r.left + 12
  if (r.top < box.top + a.top) dy = box.top + a.top - r.top + 12
  else if (r.bottom > box.bottom - a.bottom) dy = box.bottom - a.bottom - r.bottom - 12
  if (dx || dy) map.panBy(dx, dy)
}

// [上, 右, 下, 左] 视野留白（避开界面）
const padding = (extra = 40) => [props.avoid.top + extra, props.avoid.right + extra, props.avoid.bottom + extra, props.avoid.left + extra]

function boundsOf(points) {
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return new props.AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)])
}
// 适配视野（允许小数级缩放；高德 setBounds 会向下取整一级，城市视图显得过远）
function fitBounds(bounds, pad) {
  // 自己算：高德 setBounds / getFitZoomAndCenterByBounds 在大留白时会多缩小一级且不居中
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
  map.setZoomAndCenter(zoom, [(sw.lng + ne.lng) / 2, lat], true)
  map.panBy((right - left) / -2, (bottom - top) / -2)
}

// 点击区县：缩放到该区所有小区的范围（至少到小区级别）
function zoomTo(points) {
  if (!points?.length) return
  if (points.length === 1) {
    map.setZoomAndCenter(15, points[0], false, 600)
    return
  }
  fitBounds(boundsOf(points), padding(60))
  if (map.getZoom() < ZOOM_SPLIT) map.setZoom(ZOOM_SPLIT)
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
  labels = props.cityLabels.filter((c) => !props.districts.some((d) => near(d.lnglat, c.lnglat)) && !inUi(c.lnglat)).map(
    (c) => new AMap.Marker({ position: c.lnglat, anchor: 'center', content: `<div class="dm-city">${esc(c.name)}</div>`, zIndex: 100, bubble: true, clickable: false })
  )
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

function renderMarkers() {
  if (!map) return
  markers = clear(markers)
  if (props.mode === 'heat') return
  const { AMap } = props
  if (level === 'district') {
    markers = props.districts.map((d) => {
      const m = new AMap.Marker({
        position: d.lnglat,
        anchor: 'center',
        content: markerHtml({ count: d.projects.length, projects: d.projects, district: true, label: d.label }),
        zIndex: 120 + stateRank(worstState(d.projects)),
      })
      m.on('click', () => zoomTo(d.points))
      return m
    })
  } else {
    markers = props.communities.map((c) => {
      const m = new AMap.Marker({
        position: c.lnglat,
        anchor: 'center',
        content: markerHtml({ count: c.projects.length, projects: c.projects, label: c.label, named: level === 'named' }),
        zIndex: 120 + stateRank(worstState(c.projects)),
      })
      m.on('click', () => openPopover(c))
      return m
    })
  }
  map.add(markers)
  if (markers.length) requestAnimationFrame(ready)
}

// 底图要素：道路与地名（'point' 承载区县/片区/道路/地名注记）在任何缩放、任何模式下都显示，否则看不出哪里是哪里；
// 建筑只在小区级（≥ 区县分界）加上
let featuresNow = ''
function applyFeatures() {
  const f = level === 'district' ? ['bg', 'road', 'point'] : ['bg', 'road', 'building', 'point']
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

function render() {
  if (!map) return
  renderMarkers()
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
    renderMarkers()
    renderLabels()
  }
}

// × 用 pointerdown 直接关闭（捕获阶段，高德 InfoWindow 内部吞掉 click 时也可靠）
function onPopDown(e) {
  const t = e.target.closest && e.target.closest('[data-act="close"]')
  if (!t) return
  e.stopPropagation()
  e.preventDefault()
  info && info.close()
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
    pop.open.has(id) ? pop.open.delete(id) : pop.open.add(id)
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
  el.value.addEventListener('click', onPopClick)
  el.value.addEventListener('pointerdown', onPopDown, true)
  map.addControl(new AMap.Scale()) // 位置 / 样式由下方 CSS 覆盖（左下、图例上方）
  if (props.center) centerOn(props.center)
  info = new AMap.InfoWindow({ isCustom: true, autoMove: false, offset: new AMap.Pixel(0, -22 * k()), anchor: 'bottom-center' })
  el.value.style.setProperty('--k', k())
  info.on('close', () => (pop = null))
  heat = createWarmLights(AMap, map)
  level = levelFor(map.getZoom())
  applyFeatures()
  if (props.fit?.points?.length) fitBounds(boundsOf(props.fit.points), padding(40)) // 地图挂载前已算好的适配
  map.on('zoomend', onZoom)
  map.on('moveend', () => level === 'district' && renderLabels())
  map.on('click', () => info.close())
  // 底图 complete / 首批标记画出 / 1.2 s 兜底：三者最早者收起首屏罩
  map.on('complete', ready)
  setTimeout(ready, 1200)
  render()
})

watch(() => [props.communities, props.districts, props.cityLabels], render)
watch(
  () => [props.mode, props.heatMetric],
  () => {
    info && info.close()
    applyFeatures()
    render()
  }
)
function focusCommunity(key) {
  const c = props.communities.find((x) => x.key === key)
  if (!c || !map || props.mode === 'heat') return
  map.setZoomAndCenter(Math.max(15, map.getZoom()), c.lnglat, true)
  map.panBy(-(props.avoid.right - props.avoid.left) / 2, 0)
  onZoom()
  openPopover(c)
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
  }
)
watch(
  () => props.fit,
  (f) => {
    if (!f || !map || !f.points?.length) return
    info.close()
    fitBounds(boundsOf(f.points), padding(40))
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
  if (map) {
    heat && heat.destroy()
    map.off('zoomend', onZoom)
    el.value && el.value.removeEventListener('click', onPopClick)
    el.value && el.value.removeEventListener('pointerdown', onPopDown, true)
    map.destroy()
  }
  map = heat = info = null
  markers = []
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
.dm-mk:hover {
  transform: scale(1.06);
}
.dm-mk:hover .dm-mk__label {
  color: #fff;
}
.dm-mk__n {
  font: 600 calc(13px * var(--k, 1))/1 var(--dm-num);
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.dm-mk--district .dm-mk__n {
  font-size: calc(20px * var(--k, 1));
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
.dm-mk:not(.dm-mk--district) .dm-mk__label {
  font-size: calc(12px * var(--k, 1));
  color: #b7d3f0;
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
  top: calc(6px * var(--k, 1));
  right: calc(6px * var(--k, 1));
  width: calc(32px * var(--k, 1));
  height: calc(32px * var(--k, 1));
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
  list-style: none;
  margin: 0;
  padding: calc(4px * var(--k, 1)) 0;
}
.dm-pop li.pj {
  display: grid;
  grid-template-columns: calc(8px * var(--k, 1)) 1fr auto auto;
  align-items: center;
  gap: calc(10px * var(--k, 1));
  height: calc(32px * var(--k, 1));
  padding: 0 calc(14px * var(--k, 1));
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
  color: #35d4ff;
  cursor: pointer;
  white-space: nowrap;
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
  display: block;
}
.dm-pop__all {
  display: block;
  width: calc(100% - calc(28px * var(--k, 1)));
  margin: 0 calc(14px * var(--k, 1)) calc(12px * var(--k, 1));
  height: calc(30px * var(--k, 1));
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
