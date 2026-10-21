<template>
  <div ref="el" class="amap" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { createWarmLights } from './warmLights'
import { showName } from '@/utils/showroom'
import { STATES, stateRank, worstState, alarmCount, hasNewAlarm, levelState, isActiveAlarm, NOTICE_COLOR } from '@/geo/states'

// 高德地图：自定义 HTML 标记（每个小区一个，缩小时按区县汇总）+ 热力图
// communities: [{ key, lnglat, exact, label, districtName, projects: [{ id, name, state, alarmCount, area, ... }] }]
// districts:   [{ key, lnglat, label, projects }]
const props = defineProps({
  AMap: { type: Object, required: true },
  communities: { type: Array, default: () => [] },
  districts: { type: Array, default: () => [] },
  mode: { type: String, default: 'markers' }, // markers | heat
  heatMetric: { type: String, default: 'projects' }, // 热力：projects 按项目数 | alarms 按 10 天内一级告警数
  center: { type: Array, default: null },
  focus: { type: Object, default: null }, // { key, n }：飞到该小区并打开弹窗（n 变化即触发）
})
const emit = defineEmits(['open-project'])

const ZOOM_SPLIT = 12 // < 12 显示区县汇总，≥ 12 显示小区
const el = ref(null)
let map = null
let heat = null
let info = null
let markers = []
let level = null

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function markerHtml({ count, projects, approx, district, label }) {
  const state = worstState(projects)
  const alarms = alarmCount(projects)
  const size = district ? Math.min(72, 38 + Math.sqrt(count) * 6) : Math.min(44, 22 + Math.sqrt(count) * 5)
  const cls = [
    'dm-mk',
    `dm-mk--${state}`,
    approx ? 'dm-mk--approx' : '',
    district ? 'dm-mk--district' : '',
    hasNewAlarm(projects) ? 'dm-mk--pulse' : '',
  ].join(' ')
  return `<div class="${cls}" style="--size:${size}px;--c:${STATES[state].color}">
    <span class="dm-mk__n">${count}</span>
    ${alarms ? `<span class="dm-mk__badge">${alarms}</span>` : ''}
    ${district ? `<span class="dm-mk__label">${esc(label)}</span>` : ''}
  </div>`
}

const fmtTs = (ms) => {
  const d = new Date(ms)
  const z = (n) => String(n).padStart(2, '0')
  return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
}
// 告警行：时间、设备、内容、等级（不含客户信息）
const alarmRows = (alarms = []) =>
  alarms
    .slice(0, 6)
    .map((a) => {
      const st = levelState(a.level)
      const color = st === 'notice' ? NOTICE_COLOR : STATES[st].color
      const tag = isActiveAlarm(a) ? '' : a.status === 1 ? '（已恢复）' : '（已处理）'
      return `<li class="al${isActiveAlarm(a) ? ' on' : ''}"><i style="background:${color}"></i><span class="t">${fmtTs(a.ts)}</span>
        <span class="n">${esc(a.device)} · ${esc(a.content)}${tag}</span><span class="a">${a.level}级</span></li>`
    })
    .join('') + (alarms.length > 6 ? `<li class="al more">… 另 ${alarms.length - 6} 条</li>` : '')

function popoverHtml(c) {
  const rows = [...c.projects]
    .sort((a, b) => stateRank(b.state) - stateRank(a.state) || (b.alarms?.length || 0) - (a.alarms?.length || 0) || String(b.created).localeCompare(String(a.created)))
    .map(
      (p) => `<li><i style="background:${STATES[p.state]?.color || STATES.normal.color}" title="${STATES[p.state]?.label || ''}"></i>
        <span class="n">${esc(showName(p.name) || c.label)}</span><span class="a">${p.area ? `${p.area}㎡` : ''}<a class="go" data-pid="${esc(p.id)}" role="button" tabindex="0">详情 ›</a></span></li>${alarmRows(p.alarms)}`
    )
    .join('')
  const alarms = alarmCount(c.projects)
  return `<div class="dm-pop">
    <div class="dm-pop__h"><b>${esc(c.label)}</b><span>${esc(c.districtName)} · ${c.projects.length} 个项目${alarms ? ` · <em>${alarms} 条告警</em>` : ''}</span></div>
    ${c.exact ? '' : '<div class="dm-pop__warn">位置为区县中心（待校正）</div>'}
    <ul>${rows}</ul>
  </div>`
}

const SIDE_PANEL_PX = 400 // 右侧统计面板宽度：视野中心向左让出

// 点击区县：缩放到该区所有小区的范围（至少到小区级别）
function zoomTo(points) {
  if (!points?.length) return
  if (points.length === 1) {
    map.setZoomAndCenter(15, points[0])
    return
  }
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  const bounds = new props.AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)])
  map.setBounds(bounds, false, [140, 140, 120, 120 + SIDE_PANEL_PX])
  if (map.getZoom() < ZOOM_SPLIT) map.setZoom(ZOOM_SPLIT)
}

function centerOn(c) {
  map.setCenter(c, true)
  map.panBy(-SIDE_PANEL_PX / 2, 0)
}

function clearMarkers() {
  if (markers.length) map.remove(markers)
  markers = []
}

function renderMarkers() {
  if (!map) return
  clearMarkers()
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
        content: markerHtml({ count: c.projects.length, projects: c.projects, approx: !c.exact }),
        zIndex: 120 + stateRank(worstState(c.projects)),
      })
      m.on('click', () => {
        info.setContent(popoverHtml(c))
        info.open(map, c.lnglat)
      })
      return m
    })
  }
  map.add(markers)
}

const STYLE_MARKERS = 'amap://styles/darkblue'
const STYLE_HEAT = 'amap://styles/dark' // 深炭底图，让暖光更突出
let styleNow = STYLE_MARKERS
function renderHeat() {
  const on = props.mode === 'heat'
  const style = on ? STYLE_HEAT : STYLE_MARKERS
  if (style !== styleNow) {
    map.setMapStyle(style)
    // 注：曾试过热力模式隐藏 'point'，但城市/区县名也属于 point 层会一起消失，故保留全部要素
    styleNow = style
  }
  const lights = props.communities
    .map((c) => {
      if (props.heatMetric === 'alarms') {
        const list = c.projects.flatMap((p) => p.alarms || []).filter((a) => a.level === 1)
        return { lnglat: c.lnglat, count: list.length, pulse: list.some(isActiveAlarm) }
      }
      return { lnglat: c.lnglat, count: c.projects.length, pulse: false }
    })
    .filter((l) => l.count > 0) // 当前筛选下 0 个项目/告警的小区不画；待校正小区本来就不在 communities 里
  heat.set(lights, props.heatMetric === 'alarms' ? 'red' : 'gold')
  heat.show(on)
}

function render() {
  if (!map) return
  renderMarkers()
  renderHeat()
}

function onZoom() {
  const next = map.getZoom() < ZOOM_SPLIT ? 'district' : 'community'
  if (next !== level) {
    level = next
    info.close()
    renderMarkers()
  }
}

onMounted(() => {
  const { AMap } = props
  map = new AMap.Map(el.value, {
    viewMode: '2D',
    zoom: 10.5,
    center: props.center || undefined,
    mapStyle: 'amap://styles/darkblue',
  })
  // 弹窗里「详情 ›」：事件委托（弹窗是 HTML 字符串）
  el.value.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-pid]')
    if (t) emit('open-project', t.getAttribute('data-pid'))
  })
  map.addControl(new AMap.Scale({ position: { left: '24px', top: '96px' } })) // 放左上顶栏下方：左下图例随屏幕缩放会变高，放上面不会互相遮挡
  if (props.center) centerOn(props.center)
  info = new AMap.InfoWindow({ isCustom: true, offset: new AMap.Pixel(0, -20), anchor: 'bottom-center' })
  heat = createWarmLights(AMap, map)
  level = map.getZoom() < ZOOM_SPLIT ? 'district' : 'community'
  map.on('zoomend', onZoom)
  // 点击地图空白处关闭弹窗
  map.on('click', () => info.close())
  render()
})

watch(() => [props.communities, props.districts], render)
watch(
  () => [props.mode, props.heatMetric],
  () => {
    info && info.close()
    render()
  }
)
function focusCommunity(key) {
  const c = props.communities.find((x) => x.key === key)
  if (!c || !map) return
  if (props.mode === 'heat') return
  level = 'community'
  map.setZoomAndCenter(Math.max(15, map.getZoom()), c.lnglat, true)
  map.panBy(-SIDE_PANEL_PX / 2, 0)
  render()
  info.setContent(popoverHtml(c))
  info.open(map, c.lnglat)
}
watch(
  () => props.focus,
  (f) => f && focusCommunity(f.key)
)
watch(
  () => props.center,
  (c) => c && map && centerOn(c)
)

onBeforeUnmount(() => {
  if (map) {
    heat && heat.destroy()
    map.off('zoomend', onZoom)
    map.destroy()
  }
  map = heat = info = null
  markers = []
})
</script>

<style scoped>
.amap {
  width: 100%;
  height: 100%;
}
</style>

<style>
.dm-mk {
  position: relative;
  width: var(--size);
  height: var(--size);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 2px solid var(--c);
  background: radial-gradient(circle, color-mix(in srgb, var(--c) 85%, transparent) 0 52%, color-mix(in srgb, var(--c) 22%, transparent) 54% 100%);
  box-shadow: 0 0 14px color-mix(in srgb, var(--c) 70%, transparent);
  cursor: pointer;
}
.dm-mk__n {
  font: 600 12px/1 'DIN Alternate', 'Bahnschrift', 'PingFang SC', sans-serif;
  color: #04121f;
}
.dm-mk--district .dm-mk__n {
  font-size: 16px;
}
/* 近似位置（区县中心兜底）：空心虚线圈 */
.dm-mk--approx {
  border-style: dashed;
  background: rgba(4, 18, 31, 0.55);
  box-shadow: none;
}
.dm-mk--approx .dm-mk__n {
  color: var(--c);
}
.dm-mk__badge {
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font: 600 11px/18px 'PingFang SC', sans-serif;
  color: #fff;
  text-align: center;
  background: #ff4d4f;
  border: 1.5px solid #fff;
  border-radius: 9px;
}
.dm-mk__label {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 13px;
  color: #d8ecff;
  text-shadow: 0 0 4px #000, 0 0 2px #000;
}
.dm-mk--pulse::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--c);
  animation: dm-pulse 1.6s ease-out infinite;
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
.dm-pop {
  width: 320px;
  font-size: 12px;
  color: #d8ecff;
  background: rgba(6, 18, 40, 0.96);
  border: 1px solid rgba(0, 212, 255, 0.45);
  border-radius: 6px;
  box-shadow: 0 0 16px rgba(0, 212, 255, 0.2);
  overflow: hidden;
}
.dm-pop__h {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(64, 110, 180, 0.35);
}
.dm-pop__h b {
  font-size: 14px;
  color: #fff;
}
.dm-pop__h span {
  color: #7ec7ff;
}
.dm-pop__h em {
  font-style: normal;
  color: #ff6b6b;
}
.dm-pop__warn {
  padding: 4px 12px;
  color: #ffc722;
  background: rgba(255, 199, 34, 0.08);
}
.dm-pop ul {
  max-height: 240px;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.dm-pop li {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
}
.dm-pop li i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dm-pop li .n {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dm-pop li .a {
  color: #93b5d6;
  font-family: 'DIN Alternate', 'Bahnschrift', monospace;
}
.dm-pop .go {
  margin-left: 8px;
  font-family: inherit;
  color: #00d4ff;
  cursor: pointer;
  white-space: nowrap;
}
.dm-pop .go:hover {
  text-decoration: underline;
}
.dm-pop li.al {
  grid-template-columns: 8px auto 1fr auto;
  gap: 6px;
  padding: 2px 12px 2px 26px;
  font-size: 11px;
  color: #8fa9c6;
}
.dm-pop li.al.on {
  color: #ffd2d2;
}
.dm-pop li.al i {
  width: 6px;
  height: 6px;
}
.dm-pop li.al .t {
  font-family: 'DIN Alternate', 'Bahnschrift', monospace;
  color: #93b5d6;
}
.dm-pop li.al.more {
  display: block;
  color: #93b5d6;
}
</style>
