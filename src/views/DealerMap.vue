<template>
  <div class="screen">
    <!-- 地图（主视图，全屏） -->
    <div class="map-layer">
      <AmapView
        v-if="AMapRef"
        :AMap="AMapRef"
        :communities="communities"
        :districts="districtMarkers"
        :mode="mode"
        :heat-metric="heatMetric"
        :center="center"
        :focus="focus"
        @open-project="openProject"
      />
      <FallbackMap
        v-else
        :geojson="geojson"
        :map-name="geojson ? `city-${cityCode}` : ''"
        :district-stats="districtStats"
        :points="fallbackPoints"
      />
    </div>

    <!-- 叠加界面层：按 1920×1080 设计稿与详情页同比例缩放（地图本身不缩放）；层本身透明且不接收鼠标 -->
    <div class="ui" :style="uiStyle">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <template v-if="brandFor(scopeTitle)">
          <h1 class="sr-only">{{ scopeTitle }}</h1>
          <BrandLogo :name="scopeTitle" :height="38" />
        </template>
        <template v-else>
          <span class="bar" />
          <h1>{{ scopeTitle }}</h1>
        </template>
        <span class="city">{{ regionFilter ? cityName || '—' : '全部城市' }} · 项目分布</span>
      </div>
      <div class="controls">
        <div v-if="cityOptions.length > 1 || regionFilter" class="ctl">
          <span id="city-label">城市</span>
          <CityPicker
            :model-value="regionFilter"
            :options="[{ value: '', label: '全部可见范围', count: allProjects.length }, ...cityOptions.map((c) => ({ value: c.region, label: c.name, count: c.count }))]"
            label="城市"
            @update:model-value="changeRegion"
          />
        </div>
        <label v-if="distributorOptions.length > 1">
          经销商
          <select v-model="distributorFilter">
            <option value="">全部</option>
            <option v-for="d in distributorOptions" :key="d.id" :value="d.id">{{ d.name }}（{{ d.count }}）</option>
          </select>
        </label>
        <div v-if="AMapRef" class="seg">
          <button :class="{ on: mode === 'markers' }" @click="mode = 'markers'">点位</button>
          <button :class="{ on: mode === 'heat' }" @click="mode = 'heat'">热力</button>
        </div>
        <div v-if="AMapRef && mode === 'heat'" class="seg">
          <button :class="{ on: heatMetric === 'projects' }" @click="heatMetric = 'projects'">项目</button>
          <button :class="{ on: heatMetric === 'alarms' }" @click="heatMetric = 'alarms'">告警</button>
        </div>
        <span class="clock">{{ clock }}</span>
        <span class="user" :title="scopeHint">{{ userName }}</span>
        <button class="logout" @click="logout">退出</button>
      </div>
    </header>

    <!-- 顶部定位进度条 -->
    <div v-if="AMapRef && geoPending > 0" class="geo-bar">
      <i :style="{ width: `${groups.length ? (geoDone / groups.length) * 100 : 0}%` }" />
      <span>定位中 {{ geoDone }}/{{ groups.length }}</span>
    </div>

    <!-- 高德 Key 提示 -->
    <div v-if="amapNotice" class="notice">{{ amapNotice }}</div>

    <!-- 图例 + 定位进度 -->
    <div class="legend">
      <span v-for="(st, k) in STATES" :key="k"><i class="dot" :style="{ background: st.color }" />{{ st.label }}</span>
      <span class="muted-l">仅显示已确认位置</span>
      <span class="muted-l">缩放 ≥ 12 级显示小区</span>
      <span v-if="AMapRef && geoPending > 0" class="progress">定位中 {{ geoDone }}/{{ groups.length }}</span>
    </div>

    <!-- 侧栏 -->
    <aside class="side">
      <div v-if="loadError" class="card error">{{ loadError }}</div>

      <div class="card scope">
        <div>账号：{{ userName }}<span class="tag">{{ scopeKind }}</span></div>
        <div v-if="AMapRef">已定位 {{ locatedCount }} / 共 {{ groups.length }} 个小区</div>
        <div>
          已加载 {{ allProjects.length }} 个项目<template v-if="totalVisible > allProjects.length">（账号可见共 {{ totalVisible }} 个，{{ FETCH_ALL ? '加载中…' : '试用仅取第 1 页' }}）</template>
        </div>
      </div>

      <div class="kpis">
        <div v-for="k in kpis" :key="k.label" class="kpi">
          <b>{{ k.value }}</b><span>{{ k.label }}</span><small v-if="k.sub">{{ k.sub }}</small>
        </div>
      </div>

      <TechPanel :title="`一级告警 · 10天 · 进行中 ${activeAlarmCount}/${alarmJoined.length}`" variant="13" :background-color="PANEL_BG" style="height: 360px">
        <p v-if="alarmError" class="muted">{{ alarmError }}</p>
        <ul class="list alarms">
          <li v-for="a in alarmFeed" :key="a.id" :class="{ on: a.active, off: !a.located }" :title="a.located ? '定位到小区' : '该小区尚未定位'" @click="focusAlarm(a)">
            <span class="date">{{ fmtTs(a.ts) }}</span>
            <span class="name">{{ a.label }}<small>{{ a.district }}{{ a.active ? '' : a.status === 1 ? ' · 已恢复' : ' · 已处理' }}</small></span>
            <span class="meta">{{ a.device }} · {{ a.content }}</span>
            <button class="go" title="查看项目详情" @click.stop="openProject(a.projectId)">详情 ›</button>
          </li>
          <li v-if="!alarmFeed.length && !alarmError" class="empty">10 天内无一级告警</li>
        </ul>
      </TechPanel>

      <TechPanel :title="regionFilter ? '各区项目' : '各城市 / 区县项目'" variant="13" :loading="loading" :background-color="PANEL_BG" :style="{ height: `${Math.max(150, panelRows.length * 24 + 72)}px` }">
        <div v-if="areaRows.length > TOP_AREAS" class="seg seg--panel">
          <button class="on" @click="areasExpanded = !areasExpanded">{{ areasExpanded ? '收起' : `展开（${areaRows.length} 区）` }}</button>
        </div>
        <div class="chart-box fill">
          <EChart v-if="panelRows.length" :option="districtOption" />
          <div v-else class="empty">暂无数据</div>
        </div>
      </TechPanel>

      <TechPanel :title="timeMode === 'year' ? '按年份新增' : '按月份新增'" variant="13" :loading="loading" :background-color="PANEL_BG" style="height: 210px">
        <div class="seg seg--panel">
          <button :class="{ on: timeMode === 'year' }" @click="timeMode = 'year'">年</button>
          <button :class="{ on: timeMode === 'month' }" @click="timeMode = 'month'">月</button>
        </div>
        <div class="chart-box fill">
          <EChart v-if="timeStats.length" :option="timeOption" />
          <div v-else class="empty">暂无数据</div>
        </div>
      </TechPanel>

      <TechPanel title="类别 / 状态" variant="13" :loading="loading" :background-color="PANEL_BG" :style="{ height: `${(categoryRows.length + statusRows.length) * 21 + 80}px` }">
        <div class="rows">
          <div v-for="r in categoryRows" :key="'c' + r.name" class="row">
            <span class="name">{{ r.name }}</span>
            <span class="track"><i :style="{ width: r.pct + '%' }" /></span>
            <span class="val">{{ r.count }}</span>
          </div>
          <div class="divider" />
          <div v-for="r in statusRows" :key="'s' + r.name" class="row">
            <span class="name">{{ r.name }}</span>
            <span class="track"><i class="alt" :style="{ width: r.pct + '%' }" /></span>
            <span class="val">{{ r.count }}</span>
          </div>
        </div>
      </TechPanel>
    </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import TechPanel from '@/components/TechPanel.vue'
import CityPicker from '@/components/CityPicker.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useScreenScale } from '@/composables/useScreenScale'
import { brandFor } from '@/config/brand'
import EChart from '@/components/EChart.vue'
import AmapView from '@/components/AmapView.vue'
import FallbackMap from '@/components/FallbackMap.vue'
import { listAlarms, me, getDistributor, pickProjectEndpoint, projectPage, listAllProjects, listProjectsLegacy } from '@/api'
import { session } from '@/api/session'
import { useTokenRefresh } from '@/composables/useTokenRefresh'
import { toProject } from '@/geo/model'
import { loadShared, postShared } from '@/geo/shared'
import { hasAmapKey, loadAmap } from '@/geo/amap'
import { loadOverrides, loadSeed, lookupLocal, createGeocodeQueue, jitter } from '@/geo/geocoder'
import { regionInfo } from '@/utils/region'
import { STATES, applyStates, alarmStates, isActiveAlarm } from '@/geo/states'
import { fmtNumber, fmtArea } from '@/utils/format'
import { tooltipStyle, categoryAxis, valueAxis, AXIS_LABEL_COLOR } from '@/utils/chartTheme'

defineOptions({ name: 'DealerMap' })
// 屏幕适配：地图本身铺满视口、不缩放（放进 transform 容器会让鼠标坐标错位）；
// 叠在地图上的界面（顶栏/侧栏/图例）放在一个透明层里，与详情页用同一个比例缩放
const { style: uiStyle } = useScreenScale()
const PANEL_BG = 'rgba(3, 12, 30, 0.9)'
const FETCH_ALL = import.meta.env.VITE_FETCH_ALL === 'true'
const PAGE_SIZE = Number(import.meta.env.VITE_PAGE_SIZE) || 20

const router = useRouter()
const route = useRoute()
useTokenRefresh()

const loading = ref(true)
const loadError = ref('')
const userName = ref('')
const distributor = ref(null)
const allProjects = shallowRef([])
const totalVisible = ref(0)
const distributorFilter = ref('')
const distributorNames = reactive({})
const geojson = shallowRef(null)
const mode = ref('markers')
// ---------- 告警（只取 10 天内一级告警，60 秒刷新） ----------
const alarms = shallowRef([])
const alarmError = ref('')
const alarmStateMap = computed(() => alarmStates(alarms.value))
const focus = shallowRef(null)
const heatMetric = ref('projects')
let alarmTimer = null
async function loadAlarms() {
  try {
    alarms.value = await listAlarms({ level: '1', days: 10 })
    alarmError.value = ''
  } catch (e) {
    alarmError.value = e?.response?.status === 403 ? '当前账号无告警查看权限' : '告警加载失败，稍后自动重试'
  }
}
const timeMode = ref('year')
const AMapRef = shallowRef(null)
const amapNotice = ref(hasAmapKey() ? '' : '缺少高德 Key：请在 .env.local 配置 VITE_AMAP_KEY / VITE_AMAP_SECURITY 后重启。当前以区县中心近似显示。')
const geoResults = reactive({}) // groupKey → { lnglat, level, source } | { fail, reason }
const overrides = shallowRef({})
const seed = shallowRef({})
let geoReady = false // overrides + seed 加载完才开始查，避免浪费配额
let queue = null
const queuedKeys = new Set()
const retryKeys = new Set() // 「重新定位」过的小区：忽略种子里的未确认记录

// ---------- 范围 ----------
const regionFilter = computed(() => (typeof route.query.region === 'string' ? route.query.region : ''))
const scopeKind = computed(() => (distributor.value ? '经销商账号' : '平台账号'))
const scopeTitle = computed(() => distributor.value?.name || '项目分布大屏')
const scopeHint = computed(() => (distributor.value ? `经销商：${distributor.value.name}` : '平台账号：显示账号权限内全部项目'))

const cityOptions = computed(() => {
  const m = new Map()
  for (const p of allProjects.value) {
    if (!p.city) continue
    const key = `${p.province}/${p.city}`
    const o = m.get(key) || { region: key, code: p.city, name: p.cityName || p.city, count: 0 }
    o.count++
    m.set(key, o)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
})

const cityCode = computed(() => {
  const fromFilter = regionFilter.value.split('/')[1]
  if (fromFilter) return fromFilter
  const fromDealer = (distributor.value?.region || '').split('/')[1]
  if (fromDealer && cityOptions.value.some((c) => c.code === fromDealer)) return fromDealer
  return cityOptions.value[0]?.code || ''
})
const cityName = computed(() => regionInfo(cityCode.value)?.name || '')
const center = computed(() => {
  const c = regionInfo(cityCode.value)
  return c ? [c.lng, c.lat] : null
})

// 默认「全部」：账号可见的全部项目；选城市后在前端过滤（全量模式下不重新请求）
const cityProjects = computed(() => (regionFilter.value ? allProjects.value.filter((p) => p.city === cityCode.value) : allProjects.value))

const distributorOptions = computed(() => {
  const m = new Map()
  for (const p of cityProjects.value) {
    if (!p.distributorId) continue
    const o = m.get(p.distributorId) || { id: p.distributorId, count: 0 }
    o.count++
    m.set(p.distributorId, o)
  }
  return [...m.values()]
    .map((o) => ({ ...o, name: distributorNames[o.id] || `经销商 ${o.id.slice(-4)}` }))
    .sort((a, b) => b.count - a.count)
})

const projects = computed(() => {
  const list = distributorFilter.value
    ? cityProjects.value.filter((p) => p.distributorId === distributorFilter.value)
    : cityProjects.value
  // 告警接入后在此注入真实状态；开发环境可用「模拟状态」检查样式
  return applyStates(list, alarmStateMap.value)
})

// ---------- 按小区分组 ----------
const groups = computed(() => {
  const m = new Map()
  for (const p of projects.value) {
    const key = p.community ? `${p.district || p.city}|${p.community}` : `#${p.id}`
    let g = m.get(key)
    if (!g) {
      g = {
        key,
        community: p.community,
        queries: p.queries,
        keywords: p.keywords,
        geoCity: p.geoCity,
        city: p.city,
        cityName: p.cityName,
        district: p.district,
        districtName: p.districtName,
        count: 0,
        area: 0,
        types: new Set(),
        latest: '',
        projects: [],
      }
      m.set(key, g)
    }
    g.count++
    g.projects.push(p)
    g.area += p.area
    g.types.add(p.type)
    if (p.created > g.latest) g.latest = p.created
  }
  return [...m.values()]
})

const districtCenters = computed(() => {
  const out = {}
  for (const f of geojson.value?.features || []) {
    const c = f.properties?.centroid || f.properties?.center
    if (f.properties?.adcode && c) out[String(f.properties.adcode)] = c
  }
  return out
})

function fallbackPos(g) {
  const c = districtCenters.value[g.district] || (regionInfo(g.district) && [regionInfo(g.district).lng, regionInfo(g.district).lat])
  const base = c || center.value || [120.31, 31.49]
  return jitter(base, g.key)
}

// 每个「已确认」小区一个标记；未确认的不上图（只进待校正）
const communities = computed(() =>
  groups.value
    .filter((g) => geoResults[g.key]?.lnglat)
    .map((g) => {
    const r = geoResults[g.key]
    return {
      key: g.key,
      lnglat: r.lnglat,
      exact: true,
      label: g.community || '未识别小区',
      district: g.district,
      districtName: g.districtName,
      projects: g.projects,
    }
  })
)

// 缩小时按区县汇总
const districtMarkers = computed(() => {
  const m = new Map()
  for (const c of communities.value) {
    const k = c.district || 'none'
    let d = m.get(k)
    if (!d) {
      const center = districtCenters.value[c.district] || (regionInfo(c.district) && [regionInfo(c.district).lng, regionInfo(c.district).lat])
      d = { key: k, lnglat: center || c.lnglat, label: c.districtName, projects: [], points: [] }
      m.set(k, d)
    }
    d.projects.push(...c.projects)
    d.points.push(c.lnglat)
  }
  return [...m.values()]
})

// 无 Key 兜底地图的点
const fallbackPoints = computed(() =>
  groups.value.map((g) => ({
    lnglat: fallbackPos(g),
    count: g.count,
    label: g.community || '未识别小区',
    sub: [`${g.districtName} · ${g.count} 个项目`, `面积 ${fmtNumber(g.area)} ㎡`, [...g.types].join(' / ')],
  }))
)

const geoDone = computed(() => groups.value.filter((g) => geoResults[g.key] || !g.queries.length).length)
const geoPending = computed(() => groups.value.length - geoDone.value)
const locatedCount = computed(() => groups.value.filter((g) => geoResults[g.key]?.lnglat).length)
const needFix = computed(() =>
  groups.value
    .filter((g) => !g.queries.length || geoResults[g.key]?.fail)
    .map((g) => ({
      ...g,
      reason: g.queries.length ? geoResults[g.key].reason : '名称中没有可识别的小区名',
      returned: g.queries.length ? geoResults[g.key].returned : null,
    }))
    .sort((a, b) => b.count - a.count)
)

// 告警列表（最新在前）：关联到项目 → 小区标记
const projectGroup = computed(() => {
  const m = new Map()
  for (const g of groups.value) for (const p of g.projects) m.set(p.id, g)
  return m
})
const alarmJoined = computed(() => alarms.value.filter((a) => projectGroup.value.has(a.projectId)))
const activeAlarmCount = computed(() => alarmJoined.value.filter(isActiveAlarm).length)
const alarmFeed = computed(() =>
  [...alarmJoined.value]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100)
    .map((a) => {
      const g = projectGroup.value.get(a.projectId)
      return { ...a, active: isActiveAlarm(a), key: g.key, label: g.community || '未识别小区', district: g.districtName, located: Boolean(geoResults[g.key]?.lnglat) }
    })
)
const fmtTs = (ms) => {
  const d = new Date(ms)
  const z = (n) => String(n).padStart(2, '0')
  return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
}
function openProject(id) {
  if (id) router.push(`/project/${id}`)
}
function focusAlarm(a) {
  if (!a.located) return
  mode.value = 'markers'
  focus.value = { key: a.key, n: Date.now() }
}

// ---------- 统计 ----------
const kpis = computed(() => {
  const ps = projects.value
  const exact = groups.value.filter((g) => geoResults[g.key]?.lnglat).length
  // 试用（只取第 1 页）时：项目数 = 接口 total（账号真实总数），其余合计只来自已加载项目
  const partial = totalVisible.value > allProjects.value.length
  const tag = partial ? '（已加载项目）' : ''
  const filtered = Boolean(regionFilter.value || distributorFilter.value) && FETCH_ALL
  return [
    partial
      ? { label: '项目数', value: fmtNumber(totalVisible.value), sub: `已加载 ${allProjects.value.length}` }
      : filtered
        ? { label: '项目数', value: fmtNumber(ps.length), sub: `${regionFilter.value ? cityName.value : ''}${distributorFilter.value ? ' · 所选经销商' : ''} / 共 ${fmtNumber(allProjects.value.length)}` }
        : { label: '项目数', value: fmtNumber(ps.length) },
    { label: `小区数${tag}`, value: fmtNumber(groups.value.filter((g) => g.community).length) },
    { label: `建筑面积${tag}`, value: fmtArea(ps.reduce((s, p) => s + p.area, 0)) },
    { label: `房间数${tag}`, value: fmtNumber(ps.reduce((s, p) => s + p.rooms, 0)) },
    { label: `设备数${tag}`, value: fmtNumber(ps.reduce((s, p) => s + p.devices, 0)) },
    { label: '已定位 / 共计小区', value: AMapRef.value ? `${exact} / ${groups.value.length}` : '—' },
  ]
})

const districtStats = computed(() => {
  const m = new Map()
  for (const p of projects.value) {
    const o = m.get(p.districtName) || { name: p.districtName, count: 0, area: 0 }
    o.count++
    o.area += p.area
    m.set(p.districtName, o)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
})

// 侧栏：全部城市时先按城市汇总，再列前 8 个区县（可展开）；选了城市时只列区县
const TOP_AREAS = 8
const areasExpanded = ref(false)
const areaRows = computed(() => {
  const m = new Map()
  for (const p of projects.value) {
    const k = p.district || `${p.city}-none`
    const o = m.get(k) || { name: regionFilter.value ? p.districtName : `${(p.cityName || '').replace(/市$/, '')}·${p.districtName}`, count: 0, area: 0 }
    o.count++
    o.area += p.area
    m.set(k, o)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
})
const panelRows = computed(() => {
  const areas = areasExpanded.value ? areaRows.value : areaRows.value.slice(0, TOP_AREAS)
  if (regionFilter.value) return areas
  const m = new Map()
  for (const p of projects.value) {
    const k = p.city || 'none'
    const o = m.get(k) || { name: p.cityName || '未知城市', count: 0, area: 0, city: true }
    o.count++
    o.area += p.area
    m.set(k, o)
  }
  return [...[...m.values()].sort((a, b) => b.count - a.count), ...areas]
})

const districtOption = computed(() => {
  const data = [...panelRows.value].reverse()
  return {
    grid: { left: regionFilter.value ? 64 : 92, right: 40, top: 8, bottom: 8 },
    tooltip: {
      ...tooltipStyle,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const d = data[ps[0].dataIndex]
        return `${d.name}<br/>项目 ${d.count} 个<br/>面积 ${fmtNumber(d.area)} ㎡`
      },
    },
    xAxis: { ...valueAxis(), show: false },
    yAxis: categoryAxis({ data: data.map((d) => d.name), axisLine: { show: false } }),
    series: [
      {
        type: 'bar',
        data: data.map((d) =>
          d.city
            ? { value: d.count, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#b8860b' }, { offset: 1, color: '#ffc722' }] } } }
            : d.count
        ),
        barWidth: 10,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#1b62d8' }, { offset: 1, color: '#00d4ff' }] },
        },
        label: { show: true, position: 'right', color: AXIS_LABEL_COLOR, fontSize: 11 },
      },
    ],
  }
})

const timeStats = computed(() => {
  const key = timeMode.value === 'year' ? 'year' : 'month'
  const m = new Map()
  for (const p of projects.value) if (p[key]) m.set(p[key], (m.get(p[key]) || 0) + 1)
  const out = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return key === 'month' ? out.slice(-12) : out
})

const timeOption = computed(() => ({
  grid: { left: 34, right: 10, top: 16, bottom: 22 },
  tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow' } },
  xAxis: categoryAxis({ data: timeStats.value.map((d) => (timeMode.value === 'month' ? d[0].slice(2) : d[0])) }),
  yAxis: valueAxis(),
  series: [
    {
      type: 'bar',
      name: '新增项目',
      data: timeStats.value.map((d) => d[1]),
      barMaxWidth: 16,
      itemStyle: { borderRadius: [4, 4, 0, 0], color: '#3b7cff' },
    },
  ],
}))

function toRows(list, key) {
  const m = new Map()
  for (const p of list) m.set(p[key] || '未知', (m.get(p[key] || '未知') || 0) + 1)
  const max = Math.max(1, ...m.values())
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, pct: (count / max) * 100 }))
}
const categoryRows = computed(() => toRows(projects.value.map((p) => ({ ...p, c: p.category || p.type })), 'c'))
const statusRows = computed(() => {
  const rows = toRows(projects.value, 'status')
  const disabled = projects.value.filter((p) => !p.enabled).length
  if (disabled) rows.push({ name: '已停用', count: disabled, pct: (disabled / Math.max(1, ...rows.map((r) => r.count))) * 100 })
  return rows
})


// ---------- 时钟 ----------
const clock = ref('')
const tick = () => {
  const d = new Date()
  const z = (n) => String(n).padStart(2, '0')
  clock.value = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
}
tick()
const clockTimer = setInterval(tick, 20 * 1000)

// ---------- 加载 ----------
let endpoint = null

async function loadProfile() {
  const data = await me()
  const u = data?.user_entity || {}
  userName.value = u.name || '已登录'
  endpoint = pickProjectEndpoint(data?.permission_paths || [])
  if (u.parent_id) {
    try {
      distributor.value = await getDistributor(u.parent_id)
    } catch (e) {
      console.warn('经销商信息获取失败', e?.message)
    }
  }
}

let loadSeq = 0
async function loadProjects() {
  const seq = ++loadSeq
  const stale = () => seq !== loadSeq
  loading.value = true
  loadError.value = ''
  try {
    let raw
    if (endpoint && FETCH_ALL) {
      // 渐进加载：每页到达就并入（统计与已缓存点位立即可见），其余页在后台继续取
      allProjects.value = []
      distributorFilter.value = ''
      const seen = new Set()
      await listAllProjects(endpoint, {
        region: '', // 全量取一次，城市筛选在前端做
        limit: PAGE_SIZE,
        concurrency: 3,
        isStale: stale,
        onPage: (list, total) => {
          if (stale()) return
          totalVisible.value = parseInt(total, 10) || 0
          const add = list.filter((p) => !seen.has(p.id) && seen.add(p.id)).map(toProject)
          allProjects.value = allProjects.value.concat(add)
          loading.value = false
        },
      })
      if (!stale()) totalVisible.value = allProjects.value.length
      return
    } else if (endpoint) {
      const r = await projectPage(endpoint, { page: 1, limit: PAGE_SIZE, region: regionFilter.value })
      raw = r.list
      totalVisible.value = parseInt(r.total, 10) || r.list.length // total 为字符串（如 "702"）
    } else {
      const all = await listProjectsLegacy({ region: regionFilter.value })
      totalVisible.value = all.length
      raw = FETCH_ALL ? all : all.slice(0, PAGE_SIZE)
    }
    // 只保留页面需要的字段（不保留客户姓名/电话/门牌）
    allProjects.value = raw.map(toProject)
    distributorFilter.value = ''
  } catch (e) {
    loadError.value = `项目数据加载失败：${e?.response?.data?.message || e?.message}`
  } finally {
    loading.value = false
  }
}

async function loadGeojson(code) {
  geojson.value = null
  if (!code) return
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}map/city/${code}.json`)
    if (r.ok) geojson.value = await r.json()
  } catch {
    /* 无轮廓数据时仅显示点 */
  }
}

async function loadDistributorNames() {
  const ids = distributorOptions.value.map((d) => d.id).filter((id) => !distributorNames[id]).slice(0, 30)
  if (distributor.value?.id) distributorNames[distributor.value.id] = distributor.value.name
  for (const id of ids) {
    if (distributorNames[id]) continue
    try {
      const d = await getDistributor(id)
      if (d?.name) distributorNames[id] = d.name
    } catch {
      /* 无权限查看其他经销商时显示编号 */
    }
  }
}

// ?reverify=1：一次性复核没有高德匹配名称的旧结果（重新查询并上报共享缓存），本轮搜索上限 400 次
const REVERIFY = route.query.reverify === '1'
const reverifyKeys = new Set()
const needsReverify = (r) =>
  (r.lnglat && !r.matched && r.source !== 'override') ||
  (r.fail && r.source === 'recheck' && !r.returned) ||
  (r.fail && r.source === 'seed' && /需人工确认/.test(r.reason || ''))

function geocodeGroups() {
  if (!geoReady) return
  for (const g of groups.value) {
    if (geoResults[g.key] || !g.queries.length || reverifyKeys.has(g.key)) continue
    const local = lookupLocal(g, overrides.value, seed.value, { ignoreSeedFail: retryKeys.has(g.key) })
    if (local && REVERIFY && needsReverify(local)) {
      reverifyKeys.add(g.key)
      continue
    }
    if (local) geoResults[g.key] = local
  }
  if (!queue) return
  // groups 会随分页到达重新计算（新对象），用 key 集合去重，避免重复排队
  const todo = groups.value.filter((g) => !geoResults[g.key] && g.queries.length && !queuedKeys.has(g.key))
  todo.forEach((g) => queuedKeys.add(g.key))
  queue.add(todo)
}

async function initAmap() {
  if (!hasAmapKey()) return
  try {
    const AMap = await loadAmap()
    queue = createGeocodeQueue(AMap, {
      concurrency: 3,
      qps: 2.8,
      maxSearches: REVERIFY ? 400 : 150,
      onResult: (g, res) => {
        geoResults[g.key] = res
        // 新确认的小区上报共享缓存（只含归一化查询串 + 区县 adcode + 坐标 + 高德名称/地址）
        if (res.lnglat && res.source === 'amap' && g.district) postShared({ key: res.query, adcode: g.district, lnglat: res.lnglat, matched: res.matched, address: res.address, source: res.level })
      },
      onFatal: (info) => {
        amapNotice.value = `高德 Key 不可用（${info}）：请检查是否为「Web端(JS API)」Key 及安全密钥、域名白名单。`
      },
    })
    AMapRef.value = AMap
  } catch (e) {
    amapNotice.value = `高德地图加载失败：${e?.message || e}（已切换为区县近似显示）`
  }
}

function changeRegion(region) {
  router.replace({ query: { ...route.query, region: region || undefined } })
}

function logout() {
  queue && queue.stop()
  session.clear()
  router.replace('/login')
}

watch(regionFilter, async () => {
  if (FETCH_ALL && endpoint) {
    distributorFilter.value = '' // 全量模式：城市筛选纯前端
    return
  }
  await loadProjects()
})
watch(cityCode, (c) => loadGeojson(c))
watch(groups, geocodeGroups)
watch(distributorOptions, loadDistributorNames)

onMounted(async () => {
  try {
    await loadProfile()
  } catch (e) {
    loadError.value = `账号信息获取失败：${e?.response?.data?.message || e?.message}`
  }
  const [ov, sd, sh] = await Promise.all([loadOverrides(), loadSeed(), loadShared(), initAmap(), loadProjects()])
  overrides.value = ov
  seed.value = { ...sd, ...sh } // 共享缓存（OSS）优先，静态种子兜底
  geoReady = true
  loadGeojson(cityCode.value)
  geocodeGroups()
  loadAlarms()
  alarmTimer = setInterval(loadAlarms, 60000) // 告警 60 秒刷新；项目列表不重取
})

onBeforeUnmount(() => {
  clearInterval(clockTimer)
  clearInterval(alarmTimer)
  queue && queue.stop()
})
</script>

<style scoped lang="scss">
.screen {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  color: #d8ecff;
  background: url('@/assets/images/bg1.jpg') center / cover, #04070f;
}
.map-layer {
  position: absolute;
  inset: 0;
  z-index: 0; /* 高德内部的 z-index 不越过叠加界面层 */
}
.ui {
  z-index: 10;
  pointer-events: none;
  > .notice,
  > .legend,
  > .side {
    pointer-events: auto;
  }
}

.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(3, 10, 26, 0.92), rgba(3, 10, 26, 0.55) 70%, transparent);
  pointer-events: none;
  z-index: 10;
  > * {
    pointer-events: auto;
  }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  .bar {
    width: 4px;
    height: 22px;
    border-radius: 2px;
    background: linear-gradient(180deg, #00d4ff, #1b62d8);
    box-shadow: 0 0 8px rgba(0, 212, 255, 0.9);
  }
  h1 {
    font-size: 24px;
    letter-spacing: 3px;
    background: linear-gradient(180deg, #fff, #7ec7ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .city {
    font-size: 15px;
    color: #7ec7ff;
    letter-spacing: 1px;
  }
}
.controls {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  color: #7ec7ff;
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  select {
    height: 30px;
    padding: 0 8px;
    color: #d8ecff;
    background: rgba(10, 30, 64, 0.85);
    border: 1px solid rgba(88, 158, 248, 0.4);
    border-radius: 4px;
    outline: none;
  }
  .clock {
    font-family: 'DIN Alternate', 'Bahnschrift', monospace;
    color: #8aaed3;
  }
  .user {
    color: #b7d3f0;
  }
  .logout {
    height: 28px;
    padding: 0 12px;
    color: #589ef8;
    background: rgba(30, 70, 140, 0.25);
    border: 1px solid rgba(88, 158, 248, 0.35);
    border-radius: 4px;
    cursor: pointer;
    &.on {
      color: #04121f;
      background: #ffc722;
    }
  }
}
.seg {
  display: inline-flex;
  border: 1px solid rgba(88, 158, 248, 0.4);
  border-radius: 4px;
  overflow: hidden;
  button {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
    color: #7ec7ff;
    background: rgba(10, 30, 64, 0.7);
    border: 0;
    cursor: pointer;
    &.on {
      color: #04121f;
      background: #00d4ff;
    }
  }
  &--panel {
    position: absolute;
    top: -40px;
    right: 18px;
    button {
      height: 22px;
      padding: 0 8px;
    }
  }
}

.notice {
  position: absolute;
  top: 74px;
  left: 50%;
  transform: translateX(calc(-50% - 200px));
  max-width: 760px;
  padding: 10px 18px;
  font-size: 14px;
  color: #ffd76a;
  background: rgba(40, 28, 4, 0.82);
  border: 1px solid rgba(255, 199, 34, 0.6);
  border-radius: 6px;
  z-index: 10;
}

.mini {
  margin-left: 6px;
  padding: 1px 8px;
  font-size: 11px;
  color: #cfeaff;
  background: rgba(0, 212, 255, 0.12);
  border: 1px solid rgba(0, 212, 255, 0.4);
  border-radius: 4px;
  cursor: pointer;
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}
.ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #b7d3f0;
}
.geo-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 30;
  background: rgba(0, 212, 255, 0.12);
  i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #0090ff, #00d4ff);
    box-shadow: 0 0 8px #00d4ff;
    transition: width 0.3s;
  }
  span {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 10px;
    font-size: 12px;
    color: #cfeaff;
    background: rgba(3, 10, 26, 0.8);
    border: 1px solid rgba(0, 212, 255, 0.3);
    border-radius: 10px;
  }
}
.legend {
  position: absolute;
  left: 24px;
  bottom: calc(34px / var(--ui-scale, 1)); /* 让出底部高德 logo / 版权（它们不缩放，按屏幕像素留 34px） */
  display: flex;
  gap: 18px;
  padding: 8px 14px;
  font-size: 12px;
  color: #b7d3f0;
  background: rgba(3, 10, 26, 0.72);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 6px;
  z-index: 10;
  span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    &.exact {
      background: #00d4ff;
      box-shadow: 0 0 6px #00d4ff;
    }
    &.approx {
      border: 2px dashed #ffc722;
    }
  }
  .progress {
    color: #00e2a1;
  }
  .muted-l {
    color: #8fb0d0;
  }
}

.side {
  position: absolute;
  top: 72px;
  right: 16px;
  bottom: 16px;
  width: 380px;
  padding: 4px 6px 4px 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  z-index: 10;
  > :deep(.tech-panel) {
    flex: none;
  }
  :deep(.panel-body) {
    padding-bottom: 12px;
    overflow: hidden;
  }
}
.card {
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.8;
  color: #b7d3f0;
  background: rgba(3, 12, 30, 0.78);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 6px;
  &.error {
    color: #ff8a7a;
    border-color: rgba(255, 124, 92, 0.6);
  }
  .tag {
    margin-left: 8px;
    padding: 0 6px;
    font-size: 11px;
    color: #00d4ff;
    border: 1px solid rgba(0, 212, 255, 0.4);
    border-radius: 3px;
  }
}
.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  .kpi {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 4px 8px;
    background: rgba(3, 12, 30, 0.78);
    border: 1px solid rgba(0, 212, 255, 0.22);
    border-radius: 6px;
    b {
      font-family: 'DIN Alternate', 'Bahnschrift', monospace;
      font-size: 20px;
      color: #fff;
      text-shadow: 0 0 8px rgba(0, 212, 255, 0.6);
      white-space: nowrap;
    }
    span {
      margin-top: 2px;
      font-size: 12px;
      color: #7ec7ff;
      text-align: center;
      line-height: 1.3;
    }
    small {
      margin-top: 1px;
      font-size: 11px;
      color: #8aaccf;
    }
  }
}
.chart-box {
  position: relative;
  padding: 0 10px;
  &.fill {
    height: 100%;
  }
}
.empty,
.muted {
  padding: 6px 18px;
  font-size: 12px;
  color: #8fb0d0;
}
.rows {
  padding: 4px 18px 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  .row {
    display: grid;
    grid-template-columns: 92px 1fr 36px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .name {
    color: #b7d3f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    height: 8px;
    background: rgba(64, 110, 180, 0.18);
    border-radius: 4px;
    i {
      display: block;
      height: 100%;
      border-radius: 4px;
      background: #00d4ff;
      &.alt {
        background: #00e2a1;
      }
    }
  }
  .val {
    text-align: right;
    color: #fff;
    font-family: 'DIN Alternate', 'Bahnschrift', monospace;
  }
  .divider {
    height: 1px;
    margin: 3px 0;
    background: rgba(64, 110, 180, 0.3);
  }
}
.list {
  list-style: none;
  padding: 0 14px;
  li {
    display: grid;
    grid-template-columns: 78px 1fr;
    column-gap: 8px;
    padding: 6px 4px;
    font-size: 12px;
    border-bottom: 1px dashed rgba(64, 110, 180, 0.25);
    &:last-child {
      border-bottom: 0;
    }
  }
  .date {
    color: #8aaed3;
    font-family: 'DIN Alternate', 'Bahnschrift', monospace;
  }
  .name {
    color: #fff;
  }
  .meta {
    grid-column: 2;
    color: #93b5d6;
  }
  &.fix li {
    grid-template-columns: 1fr;
    .meta {
      grid-column: 1;
    }
    code {
      font-size: 11px;
      color: #ffc722;
      word-break: break-all;
    }
  }
  &.alarms {
    height: calc(100% - 8px);
    overflow-y: auto;
    li {
      cursor: pointer;
      border-left: 2px solid transparent;
      &:hover {
        background: rgba(0, 212, 255, 0.06);
      }
      &.on {
        border-left-color: #ff4d4f;
        .name {
          color: #ffd2d2;
        }
      }
      &.off {
        cursor: default;
        opacity: 0.6;
      }
    }
    .name small {
      margin-left: 6px;
      color: #93b5d6;
    }
    .meta {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    li {
      position: relative;
    }
    .go {
      position: absolute;
      top: 6px;
      right: 4px;
      padding: 0 6px;
      font: inherit;
      font-size: 11px;
      color: #00d4ff;
      background: rgba(0, 212, 255, 0.08);
      border: 1px solid rgba(0, 212, 255, 0.35);
      border-radius: 3px;
      cursor: pointer;
    }
  }
}
</style>
