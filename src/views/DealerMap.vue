<template>
  <div class="screen">
    <!-- 地图（主视图，全屏，不缩放） -->
    <div class="map-layer" :class="{ ready: mapReady || amapNotice }" :style="{ '--dm-scale-bottom': `${34 + 50 * scale}px` }">
      <AmapView
        v-if="AMapRef"
        :AMap="AMapRef"
        :communities="communities"
        :districts="districtMarkers"
        :city-labels="cityLabels"
        :mode="mode"
        :heat-metric="heatMetric"
        :center="center"
        :focus="focus"
        :fit="fit"
        :avoid="avoid"
        :scale="scale"
        @open-project="openProject"
        @ready="mapReady = true"
      />
      <FallbackMap
        v-else-if="amapNotice"
        :geojson="geojson"
        :map-name="geojson ? `city-${cityCode}` : ''"
        :district-stats="districtStats"
        :points="fallbackPoints"
      />
    </div>
    <!-- 首屏：地图瓦片到位前的品牌底（避免白底网格 / 黑→灰→蓝闪烁） -->
    <transition name="fade">
      <div v-if="!mapReady && !amapNotice" class="boot">
        <BrandLogo v-if="brand" :name="brand.name" :height="40" class="boot__logo" />
        <span class="boot__ring" />
        <span class="boot__text">{{ loading ? '正在加载项目数据…' : '正在加载地图…' }}</span>
      </div>
    </transition>

    <!-- 叠加界面层：按 1920×1080 设计稿与详情页同比例缩放；层本身透明且不接收鼠标 -->
    <div class="ui" :class="{ compact }" :style="uiStyle">
      <header class="topbar">
        <div class="brand">
          <transition name="fade" mode="out-in">
            <span v-if="!profileLoaded" key="ph" class="brand__ph" />
            <span v-else-if="brandFor(scopeTitle)" key="logo" class="brand__logo">
              <h1 class="sr-only">{{ scopeTitle }}</h1>
              <BrandLogo :name="scopeTitle" :height="32" />
            </span>
            <h1 v-else key="txt" class="brand__txt">{{ scopeTitle }}</h1>
          </transition>
          <span class="brand__sep" />
          <CityPicker
            v-if="cityOptions.length > 1 || regionFilter"
            variant="title"
            :model-value="regionFilter"
            :options="[{ value: '', label: '全部城市', count: allProjects.length }, ...cityOptions.map((c) => ({ value: c.region, label: c.name, count: c.count }))]"
            label="城市"
            @update:model-value="changeRegion"
          />
          <span v-else-if="cityName" class="brand__city">{{ cityName }}</span>
          <CityPicker
            v-if="distributorOptions.length > 1"
            :model-value="distributorFilter"
            :options="[{ value: '', label: '全部经销商', count: cityProjects.length }, ...distributorOptions.map((d) => ({ value: d.id, label: d.name, count: d.count }))]"
            label="经销商"
            @update:model-value="(v) => (distributorFilter = v)"
          />
        </div>
        <div class="controls">
          <div v-if="AMapRef" class="seg">
            <button :class="{ on: mode === 'markers' }" @click="mode = 'markers'">点位</button>
            <button :class="{ on: mode === 'heat' }" @click="mode = 'heat'">热力</button>
          </div>
          <!-- 二级分段常驻占位（点位模式下隐藏），切换模式时顶栏不跳动 -->
          <div v-if="AMapRef" class="seg seg--sub" :class="{ hidden: mode !== 'heat' }" :aria-hidden="mode !== 'heat'">
            <button :class="{ on: heatMetric === 'projects' }" :tabindex="mode === 'heat' ? 0 : -1" @click="heatMetric = 'projects'">项目</button>
            <button :class="{ on: heatMetric === 'alarms' }" :tabindex="mode === 'heat' ? 0 : -1" @click="heatMetric = 'alarms'">告警</button>
          </div>
          <div class="clock">
            <b>{{ clock.time }}</b><small>{{ clock.date }}</small>
          </div>
          <div class="user" :title="`${userName}（${scopeHint}）`">
            <span class="user__name">{{ userName || '…' }}</span>
          </div>
          <button class="logout" title="退出登录" aria-label="退出登录" @click="logout">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <span>退出</span>
          </button>
        </div>
      </header>

      <!-- 顶部 3px 定位进度条 -->
      <div v-if="AMapRef && geoPending > 0" class="geo-bar"><i :style="{ width: `${groups.length ? (geoDone / groups.length) * 100 : 0}%` }" /></div>

      <div v-if="amapNotice" class="notice">{{ amapNotice }}</div>
      <div v-if="loadError" class="notice notice--err">{{ loadError }}<button @click="reloadAll">重试</button></div>

      <!-- 图例：随模式切换 -->
      <div class="legend">
        <template v-if="mode === 'markers'">
          <span v-for="(st, k) in STATES" :key="k"><i class="dot" :style="{ '--c': st.color }" />{{ st.label }}</span>
          <span class="help" :class="{ open: helpOpen }" tabindex="0" role="button" aria-label="说明" @click="helpOpen = !helpOpen" @blur="helpOpen = false" @keydown.enter.prevent="helpOpen = !helpOpen" @keydown.esc="helpOpen = false">?<em>只显示已确认位置的小区；缩放到 12 级以上显示小区，14 级以上显示小区名</em></span>
        </template>
        <template v-else>
          <span class="heat-title">{{ heatMetric === 'alarms' ? '亮度 = 一级告警数（10 天）' : '亮度 = 小区内项目数' }}</span>
          <span v-for="t in HEAT_TIERS" :key="t.label" class="sw"><i :style="{ background: t.color }" />{{ t.label }}</span>
        </template>
      </div>

      <!-- 地图右下状态行 -->
      <div class="status">
        <span v-if="AMapRef && geoPending > 0" class="ring" />
        <template v-if="allProjects.length">已定位 {{ fmtNumber(locatedCount) }} / {{ fmtNumber(groups.length) }} 小区 · 已加载 {{ fmtNumber(allProjects.length) }} 个项目<template v-if="totalVisible > allProjects.length"> / {{ fmtNumber(totalVisible) }}</template> · 告警 {{ alarmUpdated || '—' }} 更新</template>
        <template v-else>{{ loading ? '正在加载项目…' : '' }}</template>
      </div>

      <!-- 侧栏：一屏放下，不滚动 -->
      <aside class="side">
        <section class="kpis" :class="{ skel: loading && !allProjects.length }">
          <div class="kpi kpi--hero">
            <span>项目数</span><b>{{ allProjects.length ? fmtNumber(Math.round(tw.projects.value)) : '—' }}</b>
            <small v-if="kpiSub">{{ kpiSub }}</small>
          </div>
          <div class="kpi"><span>小区数</span><b>{{ allProjects.length ? fmtNumber(Math.round(tw.communities.value)) : '—' }}</b></div>
          <div class="kpi"><span>建筑面积</span><b>{{ allProjects.length ? fmtAreaParts(tw.area.value)[0] : '—' }}<i v-if="allProjects.length">{{ fmtAreaParts(tw.area.value)[1] }}</i></b></div>
          <div class="kpi"><span>房间数</span><b>{{ allProjects.length ? fmtNumber(Math.round(tw.rooms.value)) : '—' }}</b></div>
          <div class="kpi"><span>设备数</span><b>{{ allProjects.length ? fmtNumber(Math.round(tw.devices.value)) : '—' }}</b></div>
        </section>

        <TechPanel class="p-alarm" :loading="!alarmsLoaded">
          <template #title>
            一级告警
            <em v-if="activeAlarmCount" class="pill">进行中 {{ activeAlarmCount }}</em>
            <small v-if="alarmsLoaded && allProjects.length">/ {{ alarmJoined.length }} · 近 10 天</small>
          </template>
          <p v-if="alarmError" class="muted">{{ alarmError }}</p>
          <ul v-else-if="alarmFeed.length" class="alarms">
            <li
              v-for="a in alarmFeed"
              :key="a.id"
              :class="{ on: a.active, fresh: a.fresh, off: !a.located }"
              :title="a.located ? `${fmtAbs(a.ts)} · 点击定位到小区` : undefined"
              :tabindex="a.located ? 0 : -1"
              @click="focusAlarm(a)"
              @keydown.enter.prevent="focusAlarm(a)"
            >
              <span class="l1"><b class="name">{{ a.label }}</b><small>{{ a.district }}</small><span class="t">{{ fmtRel(a.ts) }}</span></span>
              <span class="l2"><span v-marquee class="meta"><span>{{ a.text }}</span></span><em v-if="!a.active" class="tag">{{ a.status === 1 ? '已恢复' : '已处理' }}</em><button v-if="!a.located" class="unloc" type="button" title="该小区尚未定位，点击查看项目详情" @click.stop="openProject(a.projectId)">未定位</button></span>
              <i class="chev" aria-hidden="true">›</i>
            </li>
          </ul>
          <div v-else-if="alarmsLoaded" class="ok">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#00e2a1" stroke-width="1.6" /><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#00e2a1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <b>近 10 天无一级告警</b><small>系统运行正常</small>
          </div>
        </TechPanel>

        <TechPanel class="p-area" :title="cityName ? `${cityName} · 各区项目` : '各区项目'" :loading="loading && !allProjects.length">
          <!-- 全部区县直接列出（紧凑行高）；放不下时面板内滚动（滚轮不会缩放地图） -->
          <div v-if="areaRows.length" class="rows">
            <div v-for="r in areaRows" :key="r.name" class="row">
              <span class="name">{{ r.name }}</span>
              <span class="track"><i :style="{ width: r.pct + '%' }" /></span>
              <span class="val">{{ r.count }}<small>{{ fmtArea(r.area) }}</small></span>
            </div>
          </div>
          <div v-else-if="!loading" class="muted">暂无数据</div>
        </TechPanel>

        <TechPanel v-if="!compact" class="p-trend" :title="timeMode === 'year' ? '按年份新增' : '按月份新增'" :loading="loading && !allProjects.length">
          <template #extra>
            <div class="seg seg--mini">
              <button :class="{ on: timeMode === 'year' }" @click="timeMode = 'year'">年</button>
              <button :class="{ on: timeMode === 'month' }" @click="timeMode = 'month'">月</button>
            </div>
          </template>
          <div class="chart-box">
            <EChart v-if="timeStats.length" :option="timeOption" />
            <div v-else-if="!loading" class="muted">暂无数据</div>
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
import { brandFor, defaultBrand } from '@/config/brand'
import EChart from '@/components/EChart.vue'
import AmapView from '@/components/AmapView.vue'
import FallbackMap from '@/components/FallbackMap.vue'
import { listAlarms, me, getDistributor, pickProjectEndpoint, projectPage, listAllProjects, listProjectsLegacy } from '@/api'
import { toLogin, errorText } from '@/api/http'
import { useTokenRefresh } from '@/composables/useTokenRefresh'
import { toProject } from '@/geo/model'
import { loadShared, postShared } from '@/geo/shared'
import { hasAmapKey, loadAmap } from '@/geo/amap'
import { loadOverrides, loadSeed, lookupLocal, createGeocodeQueue, jitter } from '@/geo/geocoder'
import { regionInfo } from '@/utils/region'
import { STATES, applyStates, alarmStates, isActiveAlarm } from '@/geo/states'
import { fmtNumber, fmtArea } from '@/utils/format'
import { tooltipStyle, categoryAxis, valueAxis } from '@/utils/chartTheme'
import { vMarquee, alarmText } from '@/directives/marquee'

const helpOpen = ref(false) // 图例「?」点按/遥控确认键展开（电视无悬停）

defineOptions({ name: 'DealerMap' })
// 屏幕适配：地图本身铺满视口、不缩放；叠加界面放在一个透明层里，与详情页用同一个比例缩放
const { style: uiStyle, scale } = useScreenScale()
// 逻辑画布矮（如 1350×700 笔记本）时收起「新增趋势」，把高度让给一级告警
const compact = ref(false)
const measure = () => (compact.value = window.innerHeight / scale.value < 940)
onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
const FETCH_ALL = import.meta.env.VITE_FETCH_ALL === 'true'
const PAGE_SIZE = Number(import.meta.env.VITE_PAGE_SIZE) || 20
const SIDE_W = 380 // 侧栏宽（设计稿像素）
// 地图上被界面占用的区域（屏幕像素）：弹窗/飞行/适配视野时避开
const avoid = computed(() => {
  const s = scale.value
  return { top: Math.round(96 * s), right: Math.round((SIDE_W + 16 + 24) * s), bottom: Math.round(34 + 60 * s), left: Math.round(24 * s) }
})
const HEAT_TIERS = [
  { label: '1', color: 'rgba(255,184,87,0.35)' },
  { label: '2–4', color: 'rgba(255,184,87,0.55)' },
  { label: '5–9', color: 'rgba(255,200,120,0.75)' },
  { label: '10–19', color: 'rgba(255,222,158,0.9)' },
  { label: '20+', color: '#fff5db' },
]

const router = useRouter()
const route = useRoute()
useTokenRefresh()

const brand = defaultBrand()
const loading = ref(true)
const loadError = ref('')
const profileLoaded = ref(false)
const mapReady = ref(false)
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
const alarmsLoaded = ref(false)
const alarmUpdated = ref('')
const alarmStateMap = computed(() => alarmStates(alarms.value))
const focus = shallowRef(null)
const fit = shallowRef(null)
const heatMetric = ref('projects')
let alarmTimer = null
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
async function loadAlarms() {
  try {
    alarms.value = await listAlarms({ level: '1', days: 10 })
    alarmError.value = ''
    alarmUpdated.value = hhmm()
  } catch (e) {
    alarmError.value = e?.response?.status === 403 ? '当前账号无告警查看权限' : '告警加载失败，稍后自动重试'
  } finally {
    alarmsLoaded.value = true
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
const retryKeys = new Set()

// ---------- 范围 ----------
const regionFilter = computed(() => (typeof route.query.region === 'string' ? route.query.region : ''))
// 默认城市 = 无锡市：每次登录 / 打开大屏都从无锡开始（「全部城市」可手动切换，本次会话内保持）；账号下没有无锡项目时退回全部城市
const DEFAULT_REGION = '320000/320200'
if (typeof route.query.region !== 'string') router.replace({ query: { ...route.query, region: DEFAULT_REGION } })
let defaultChecked = false
const scopeTitle = computed(() => distributor.value?.name || '项目分布大屏')
const scopeHint = computed(() => (distributor.value ? '经销商账号' : '平台账号'))

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

// 主城市：所选城市 → 经销商所在城市 → 项目最多的城市
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
// 城市名标签（远景时底图地名隐藏，由我们自己画）
const cityLabels = computed(() =>
  cityOptions.value.map((c) => ({ key: c.code, name: c.name, info: regionInfo(c.code) })).filter((c) => c.info).map((c) => ({ key: c.key, name: c.name, lnglat: [c.info.lng, c.info.lat] }))
)

const cityProjects = computed(() => (regionFilter.value ? allProjects.value.filter((p) => p.city === cityCode.value) : allProjects.value))

const distributorOptions = computed(() => {
  const m = new Map()
  for (const p of cityProjects.value) {
    if (!p.distributorId) continue
    const o = m.get(p.distributorId) || { id: p.distributorId, count: 0 }
    o.count++
    m.set(p.distributorId, o)
  }
  return [...m.values()].map((o) => ({ ...o, name: distributorNames[o.id] || `经销商 ${o.id.slice(-4)}` })).sort((a, b) => b.count - a.count)
})

const projects = computed(() => {
  const list = distributorFilter.value ? cityProjects.value.filter((p) => p.distributorId === distributorFilter.value) : cityProjects.value
  return applyStates(list, alarmStateMap.value)
})

// ---------- 按小区分组 ----------
const groups = computed(() => {
  const m = new Map()
  for (const p of projects.value) {
    // 分组 / 缓存按地理编码范围（geoDistrict：区县，'' = 全市）；展示、汇总按所填区县（areaDistrict）
    const key = p.community ? `${p.geoDistrict || p.city}|${p.community}` : `#${p.id}`
    let g = m.get(key)
    if (!g) {
      g = { key, community: p.community, vague: p.vague, queries: p.queries, keywords: p.keywords, geoCity: p.geoCity, city: p.city, cityName: p.cityName, district: p.geoDistrict, areaDistrict: p.district, districtName: p.districtName, count: 0, area: 0, types: new Set(), latest: '', projects: [] }
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
const districtCenter = (code) => districtCenters.value[code] || (regionInfo(code) && [regionInfo(code).lng, regionInfo(code).lat])

function fallbackPos(g) {
  return jitter(districtCenter(g.areaDistrict || g.district) || center.value || [120.31, 31.49], g.key)
}

// 每个「已确认」小区一个标记；未确认的不上图
const communities = computed(() =>
  groups.value
    .filter((g) => geoResults[g.key]?.lnglat)
    .map((g) => ({ key: g.key, lnglat: geoResults[g.key].lnglat, exact: true, label: g.community || '未识别小区', district: g.areaDistrict, districtName: g.districtName, projects: g.projects }))
)

// 缩小时按区县汇总
const districtMarkers = computed(() => {
  const m = new Map()
  for (const c of communities.value) {
    const k = c.district || 'none'
    let d = m.get(k)
    if (!d) {
      d = { key: k, lnglat: districtCenter(c.district) || c.lnglat, label: c.districtName, projects: [], points: [] }
      m.set(k, d)
    }
    d.projects.push(...c.projects)
    d.points.push(c.lnglat)
  }
  return [...m.values()]
})

const fallbackPoints = computed(() =>
  groups.value.map((g) => ({ lnglat: fallbackPos(g), count: g.count, label: g.community || '未识别小区', sub: [`${g.districtName} · ${g.count} 个项目`, `面积 ${fmtNumber(g.area)} ㎡`, [...g.types].join(' / ')] }))
)

const geoDone = computed(() => groups.value.filter((g) => geoResults[g.key] || !g.queries.length).length)
const geoPending = computed(() => groups.value.length - geoDone.value)
const locatedCount = computed(() => groups.value.filter((g) => geoResults[g.key]?.lnglat).length)

// ---------- 初始视野 / 切换城市：适配到主城市所有区县（避开侧栏） ----------
const sameCity = (district, city) => district && city && String(district).slice(0, 4) === String(city).slice(0, 4)
let fittedFor = ''
let fitStart = 0
function fitCity() {
  // 只用区县中心（个别小区坐标离群会把视野拉得过远）
  const pts = districtMarkers.value.filter((d) => sameCity(d.key, cityCode.value)).map((d) => d.lnglat)
  if (!pts.length) return
  if (!fittedFor.startsWith(`${cityCode.value}:`)) fitStart = Date.now()
  fittedFor = `${cityCode.value}:${pts.length}`
  fit.value = { points: pts, n: Date.now() }
}
// 渐进加载时主城市的区县会陆续出现：切换城市后 15 秒内区县数增加就重新适配（之后不再打扰用户的视野）
const cityDistrictCount = computed(() => districtMarkers.value.filter((d) => sameCity(d.key, cityCode.value)).length)
watch(
  () => [cityCode.value, cityDistrictCount.value, regionFilter.value],
  ([code, n], old) => {
    if (!n) return
    if (old && old[2] !== regionFilter.value) fittedFor = ''
    const sameCityFitted = fittedFor.startsWith(`${code}:`)
    if (!sameCityFitted || (fittedFor !== `${code}:${n}` && Date.now() - fitStart < 15000)) fitCity()
  }
)

// ---------- 告警列表（最新在前） ----------
const projectGroup = computed(() => {
  const m = new Map()
  for (const g of groups.value) for (const p of g.projects) m.set(p.id, g)
  return m
})
const alarmJoined = computed(() => alarms.value.filter((a) => projectGroup.value.has(a.projectId)))
const activeAlarmCount = computed(() => alarmJoined.value.filter(isActiveAlarm).length)
const alarmFeed = computed(() =>
  [...alarmJoined.value]
    .sort((a, b) => isActiveAlarm(b) - isActiveAlarm(a) || b.ts - a.ts)
    .slice(0, 100)
    .map((a) => {
      const g = projectGroup.value.get(a.projectId)
      const active = isActiveAlarm(a)
      return { ...a, text: alarmText(a.device, a.content), active, fresh: active && Date.now() - a.ts < 3600e3, key: g.key, label: g.community || '未识别小区', district: g.districtName, located: Boolean(geoResults[g.key]?.lnglat) }
    })
)
const z2 = (n) => String(n).padStart(2, '0')
const fmtAbs = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${hhmm(d)}`
}
// 相对时间：「32 分钟前」「今天 08:25」「昨天 13:47」「10-18 10:01」
const fmtRel = (ms) => {
  const now = new Date()
  const d = new Date(ms)
  const diff = now - d
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= day0) return `今天 ${hhmm(d)}`
  if (ms >= day0 - 864e5) return `昨天 ${hhmm(d)}`
  return `${z2(d.getMonth() + 1)}-${z2(d.getDate())} ${hhmm(d)}`
}
function openProject(id) {
  if (id) router.push(`/project/${id}`)
}
function focusAlarm(a) {
  if (!a.located) return
  mode.value = 'markers'
  focus.value = { key: a.key, n: Date.now() }
}

// ---------- KPI（数值 400ms 缓动） ----------
const sum = (k) => projects.value.reduce((s, p) => s + (Number(p[k]) || 0), 0)
const kpiRaw = computed(() => ({
  projects: projects.value.length,
  communities: groups.value.filter((g) => g.community).length,
  area: sum('area'),
  rooms: sum('rooms'),
  devices: sum('devices'),
}))
function useTween(get) {
  const out = ref(get())
  let raf = 0
  watch(get, (to) => {
    cancelAnimationFrame(raf)
    const from = out.value
    const t0 = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 400)
      out.value = from + (to - from) * (1 - Math.pow(1 - k, 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  })
  return out
}
const tw = Object.fromEntries(['projects', 'communities', 'area', 'rooms', 'devices'].map((k) => [k, useTween(() => kpiRaw.value[k])]))
const fmtAreaParts = (v) => (v >= 10000 ? [(v / 10000).toFixed(2), '万㎡'] : [fmtNumber(Math.round(v)), '㎡'])
const kpiSub = computed(() => {
  if (totalVisible.value > allProjects.value.length) return `已加载 ${fmtNumber(allProjects.value.length)} / ${fmtNumber(totalVisible.value)}`
  if (regionFilter.value || distributorFilter.value) return `${cityName.value || ''} / 共 ${fmtNumber(allProjects.value.length)}`
  return ''
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

// 区县面板：只列主城市（所选城市 / 经销商所在城市）的全部区县，不含其它城市与城市汇总行
const areaRows = computed(() => {
  const m = new Map()
  for (const p of projects.value) {
    if (p.city !== cityCode.value) continue
    const k = p.district || 'none'
    const o = m.get(k) || { name: p.districtName || '未知区县', count: 0, area: 0 }
    o.count++
    o.area += p.area
    m.set(k, o)
  }
  const rows = [...m.values()].sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...rows.map((r) => r.count))
  return rows.map((r) => ({ ...r, pct: Math.max(2, (r.count / max) * 100) }))
})

const timeStats = computed(() => {
  const key = timeMode.value === 'year' ? 'year' : 'month'
  const m = new Map()
  for (const p of projects.value) if (p[key]) m.set(p[key], (m.get(p[key]) || 0) + 1)
  const out = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return key === 'month' ? out.slice(-12) : out
})
const timeOption = computed(() => {
  const last = timeStats.value.length - 1
  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 34, right: 10, top: 18, bottom: 22 },
    tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: categoryAxis({ data: timeStats.value.map((d) => (timeMode.value === 'month' ? d[0].slice(2) : d[0])), axisLabel: { color: '#8fb0d0', fontSize: 12 } }),
    yAxis: valueAxis({ splitNumber: 3, axisLabel: { color: '#8fb0d0', fontSize: 11 } }),
    series: [
      {
        type: 'bar',
        name: '新增项目',
        data: timeStats.value.map((d, i) => ({ value: d[1], itemStyle: { color: i === last ? '#35d4ff' : 'rgba(53,212,255,0.55)' } })),
        barMaxWidth: 16,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        label: { show: timeStats.value.length <= 12, position: 'top', color: '#b7d3f0', fontSize: 11 },
      },
    ],
  }
})

// ---------- 时钟 ----------
const WEEK = '日一二三四五六'
const clock = reactive({ time: '', date: '' })
const tick = () => {
  const d = new Date()
  clock.time = hhmm(d)
  clock.date = `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())} 周${WEEK[d.getDay()]}`
}
tick()
const clockTimer = setInterval(tick, 10 * 1000)

// ---------- 加载 ----------
let endpoint = null

async function loadProfile() {
  const data = await me()
  const u = data?.user_entity || {}
  userName.value = u.name || '已登录'
  endpoint = pickProjectEndpoint(data?.permission_paths || [])
  // 经销商资料只影响标题 / logo：不阻塞项目加载
  const dist = u.parent_id
    ? getDistributor(u.parent_id)
        .then((d) => (distributor.value = d))
        .catch((e) => console.warn('经销商信息获取失败', e?.message))
    : Promise.resolve()
  dist.finally(() => {
    profileLoaded.value = true
    document.title = `${distributor.value?.name ? brandFor(distributor.value.name)?.name || distributor.value.name : '项目分布'} · 项目分布大屏`
  })
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
      allProjects.value = []
      distributorFilter.value = ''
      const seen = new Set()
      await listAllProjects(endpoint, {
        region: '',
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
      totalVisible.value = parseInt(r.total, 10) || r.list.length
    } else {
      const all = await listProjectsLegacy({ region: regionFilter.value })
      totalVisible.value = all.length
      raw = FETCH_ALL ? all : all.slice(0, PAGE_SIZE)
    }
    allProjects.value = raw.map(toProject)
    distributorFilter.value = ''
  } catch (e) {
    loadError.value = `项目数据加载失败：${errorText(e)}`
  } finally {
    if (!stale()) loading.value = false
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

// ?reverify=1：一次性复核没有高德匹配名称的旧结果
const REVERIFY = route.query.reverify === '1'
const reverifyKeys = new Set()
const needsReverify = (r) => (r.lnglat && !r.matched && r.source !== 'override') || (r.fail && r.source === 'recheck' && !r.returned) || (r.fail && r.source === 'seed' && /需人工确认/.test(r.reason || ''))

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
        if (res.lnglat && res.source === 'amap' && (g.district || g.city)) postShared({ key: res.query, adcode: g.district || g.city, lnglat: res.lnglat, matched: res.matched, address: res.address, source: res.level })
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

// 退出：整页重载回登录页（销毁 keep-alive 的地图实例、弹窗与内存中的项目/告警数据；本机坐标缓存保留）
function logout() {
  queue && queue.stop()
  toLogin()
}

function reloadAll() {
  loadProjects()
  loadAlarms()
}

watch(regionFilter, async () => {
  if (FETCH_ALL && endpoint) {
    distributorFilter.value = ''
    return
  }
  await loadProjects()
})
watch(cityCode, (c) => loadGeojson(c))
watch(loading, (l) => {
  if (l || defaultChecked || !allProjects.value.length) return
  defaultChecked = true
  if (regionFilter.value === DEFAULT_REGION && !allProjects.value.some((p) => p.city === DEFAULT_REGION.split('/')[1])) changeRegion('')
})
watch(groups, geocodeGroups)
watch(distributorOptions, loadDistributorNames)

onMounted(async () => {
  // 并行：高德 JS、坐标缓存与账号资料同时开始；项目列表只依赖 /me（选接口）
  const amapP = initAmap()
  const geoP = Promise.all([loadOverrides(), loadSeed(), loadShared()])
  try {
    await loadProfile()
  } catch (e) {
    profileLoaded.value = true
    loadError.value = `账号信息获取失败：${errorText(e)}`
  }
  loadAlarms()
  alarmTimer = setInterval(loadAlarms, 60000)
  const projP = loadProjects()
  const [ov, sd, sh] = await geoP
  overrides.value = ov
  seed.value = { ...sd, ...sh }
  geoReady = true
  geocodeGroups()
  await Promise.all([amapP, projP])
  loadGeojson(cityCode.value)
  geocodeGroups()
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
  color: var(--dm-text-2);
  background: var(--dm-bg);
}
.map-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  transition: opacity 0.5s ease;
  &.ready {
    opacity: 1;
  }
}
.boot {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  pointer-events: none;
  background: radial-gradient(60% 70% at 50% 50%, rgba(27, 98, 216, 0.14), transparent 70%), rgba(6, 16, 36, 0.92);
  &__logo {
    animation: breathe 2.4s ease-in-out infinite;
  }
  &__ring {
    width: 22px;
    height: 22px;
    border: 2px solid rgba(53, 212, 255, 0.2);
    border-top-color: var(--dm-accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  &__text {
    font-size: 13px;
    color: var(--dm-text-3);
  }
}
@keyframes breathe {
  50% {
    opacity: 0.55;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.ui {
  z-index: 10;
  pointer-events: none;
  > .notice,
  > .legend,
  > .side,
  > .status {
    pointer-events: auto;
  }
}

/* ---------- 顶栏 ---------- */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 96px;
  padding: 0 24px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(4, 11, 24, 0.92) 0, rgba(4, 11, 24, 0.8) 64px, rgba(4, 11, 24, 0) 96px);
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
  gap: 16px;
  &__ph {
    display: block;
    width: 150px;
    height: 32px;
  }
  &__logo {
    display: flex;
  }
  &__txt {
    font-size: 22px;
    font-weight: 600;
    color: var(--dm-text);
  }
  &__sep {
    width: 1px;
    height: 22px;
    background: var(--dm-line);
  }
  &__city {
    font-size: 20px;
    font-weight: 600;
    color: var(--dm-text);
  }
}
.controls {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 13px;
}
.seg {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  button {
    position: relative;
    height: 36px;
    min-width: 56px;
    padding: 0 14px;
    font: inherit;
    font-size: 13px;
    color: var(--dm-text-2);
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    &:hover:not(.on) {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }
    &:focus-visible {
      outline: 2px solid var(--dm-accent);
      outline-offset: 1px;
    }
    &.on {
      color: #04121f;
      font-weight: 600;
      background: var(--dm-accent);
    }
    /* 点按区域扩到 40px（电视规则），视觉不变 */
    &::after {
      content: '';
      position: absolute;
      inset: -2px -1px;
    }
  }
  &--sub {
    margin-left: -8px;
    transition: opacity 0.2s;
    &.hidden {
      visibility: hidden;
      opacity: 0;
    }
  }
  &--mini button {
    height: 30px;
    min-width: 0;
    padding: 0 10px;
    font-size: 12px;
  }
}
.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1;
  b {
    font: 600 20px/1 var(--dm-num);
    color: var(--dm-text);
    font-variant-numeric: tabular-nums;
  }
  small {
    margin-top: 3px;
    font-size: 12px;
    color: var(--dm-text-3);
  }
}
.user {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 200px;
  &__name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--dm-text-2);
  }
}
.logout {
  /* 始终展开（图标 + 「退出」+ 边框）：大屏在电视上，没有悬停 */
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  height: 36px;
  padding: 0 12px 0 10px;
  font: inherit;
  font-size: 13px;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--dm-line);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  span {
    white-space: nowrap;
  }
  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: var(--dm-accent);
  }
  &:focus-visible {
    background: rgba(255, 255, 255, 0.12);
    border-color: var(--dm-accent);
    outline: 2px solid var(--dm-accent);
    outline-offset: 2px;
  }
  &::after {
    content: '';
    position: absolute;
    inset: -3px;
  }
}

.geo-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 30;
  background: rgba(53, 212, 255, 0.1);
  i {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #0090ff, var(--dm-accent));
    transition: width 0.3s;
  }
}
.notice {
  position: absolute;
  top: 80px;
  left: 24px;
  max-width: 760px;
  padding: 10px 16px;
  font-size: 13px;
  color: #ffd76a;
  background: rgba(40, 28, 4, 0.85);
  border: 1px solid rgba(255, 199, 34, 0.5);
  border-radius: 8px;
  z-index: 10;
  &--err {
    color: #ffb3a8;
    background: rgba(48, 10, 10, 0.85);
    border-color: rgba(255, 124, 92, 0.5);
  }
  button {
    margin-left: 12px;
    padding: 2px 10px;
    font: inherit;
    font-size: 12px;
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 4px;
    cursor: pointer;
  }
}

/* ---------- 图例 / 状态行 ---------- */
.glass {
  background: var(--dm-panel);
  border: 1px solid var(--dm-line);
  border-radius: 10px;
  backdrop-filter: blur(12px);
}
.legend {
  @extend .glass;
  position: absolute;
  left: 24px;
  bottom: calc(34px / var(--ui-scale, 1)); /* 让出底部高德 logo / 版权（按屏幕像素留 34px） */
  height: 36px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 14px;
  font-size: 13px;
  color: var(--dm-text-2);
  z-index: 10;
  span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--c);
    background: color-mix(in srgb, var(--c) 20%, transparent);
  }
  .help {
    position: relative;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-size: 12px;
    color: var(--dm-text-3);
    border: 1px solid var(--dm-line);
    border-radius: 50%;
    cursor: pointer;
    /* 18px 的圆，点按区域 40×40 */
    &::before {
      content: '';
      position: absolute;
      inset: -11px;
    }
    em {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 10px);
      width: 260px;
      padding: 8px 12px;
      font-size: 12px;
      font-style: normal;
      line-height: 1.6;
      color: var(--dm-text-2);
      background: rgba(6, 16, 36, 0.96);
      border: 1px solid var(--dm-line);
      border-radius: 8px;
      transform: translateX(-50%);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
    }
    &:hover em,
    &.open em {
      opacity: 1;
    }
  }
  .heat-title {
    color: var(--dm-text-3);
  }
  .sw i {
    width: 16px;
    height: 10px;
    border-radius: 2px;
  }
}
.status {
  position: absolute;
  right: calc(16px + #{380px} + 16px);
  bottom: calc(34px / var(--ui-scale, 1) + 10px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  font-size: 12px;
  color: #7f9cc0;
  background: rgba(4, 11, 24, 0.72);
  border-radius: 6px;
  backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
  .ring {
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(53, 212, 255, 0.25);
    border-top-color: var(--dm-accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
}

/* ---------- 侧栏 ---------- */
.side {
  position: absolute;
  top: 72px;
  right: 16px;
  bottom: 24px;
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
}
.kpis {
  @extend .glass;
  flex: none;
  display: grid;
  grid-template-columns: 1.15fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  height: 128px;
  overflow: hidden;
  .kpi {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 0 14px;
    border-left: 1px solid rgba(120, 170, 255, 0.1);
    &:nth-child(n + 4) {
      border-top: 1px solid rgba(120, 170, 255, 0.1);
    }
    span {
      font-size: 12px;
      color: #7fa3c8;
    }
    b {
      font: 600 24px/1 var(--dm-num);
      color: var(--dm-text);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      i {
        margin-left: 3px;
        font: 500 12px/1 var(--dm-font);
        font-style: normal;
        color: var(--dm-text-3);
      }
    }
    small {
      font-size: 12px;
      color: var(--dm-text-3);
    }
  }
  .kpi--hero {
    grid-row: 1 / 3;
    border-left: 0;
    padding-left: 18px;
    b {
      font-size: 40px;
    }
  }
  &.skel b {
    color: transparent;
    width: 60%;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(120, 170, 255, 0.08), rgba(120, 170, 255, 0.16), rgba(120, 170, 255, 0.08)) 0 0 / 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
.p-alarm {
  flex: 1 1 0;
  min-height: 160px;
}
.p-area {
  flex: none;
  max-height: 340px;
  :deep(.panel-body) {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}
.compact .p-area {
  max-height: 248px;
  .rows {
    gap: 5px;
  }
}
.compact .alarms li {
  height: 46px;
}
.p-trend {
  flex: none;
  height: 160px;
}
.pill {
  margin-left: 8px;
  padding: 1px 8px;
  font: 600 12px/18px var(--dm-font);
  font-style: normal;
  color: #fff;
  background: var(--dm-alarm);
  border-radius: 9px;
}
:deep(.title-text) small {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--dm-text-3);
}
.muted {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--dm-text-3);
}
.ok {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  b {
    font-size: 14px;
    font-weight: 500;
    color: var(--dm-text);
  }
  small {
    font-size: 12px;
    color: var(--dm-text-3);
  }
}
.alarms {
  height: 100%;
  overflow-y: auto;
  list-style: none;
  padding: 0 8px 8px;
  li {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    height: 56px;
    padding: 0 26px 0 12px;
    border-bottom: 1px solid rgba(120, 170, 255, 0.1);
    border-left: 3px solid transparent;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.15s;
    &:hover {
      background: rgba(53, 212, 255, 0.06);
    }
    &.on {
      border-left-color: var(--dm-alarm);
    }
    &:not(.on) {
      opacity: 0.55;
    }
    &.off {
      cursor: default;
    }
  }
  .l1,
  .l2 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 500;
    color: var(--dm-text);
  }
  .l1 small {
    flex: none;
    font-size: 12px;
    color: #7fa3c8;
  }
  .t {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--dm-text-3);
    font-variant-numeric: tabular-nums;
  }
  li.on .t::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 5px;
    vertical-align: 1px;
    background: var(--dm-alarm);
    border-radius: 50%;
  }
  li.fresh .t::before {
    animation: breathe 2.4s ease-in-out infinite;
  }
  .meta {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--dm-text-3);
    > span {
      display: inline;
    }
    /* 溢出时横向滚动（v-marquee），两端柔和渐隐 */
    &.mq {
      text-overflow: clip;
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 14px), transparent);
      mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 14px), transparent);
      > span {
        display: inline-block;
        padding-left: 4px;
        will-change: transform;
      }
    }
  }
  .unloc {
    position: relative;
    flex: none;
    height: 28px;
    padding: 0 10px;
    font: inherit;
    font-size: 12px;
    line-height: 26px;
    color: #ffc722;
    background: rgba(255, 199, 34, 0.1);
    border: 1px solid rgba(255, 199, 34, 0.45);
    border-radius: 3px;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      background: rgba(255, 199, 34, 0.2);
      outline: none;
    }
    &:focus-visible {
      outline: 2px solid #ffc722;
      outline-offset: 1px;
    }
    &::after {
      content: '';
      position: absolute;
      inset: -6px 0;
    }
  }
  .tag {
    flex: none;
    font-size: 11px;
    font-style: normal;
    color: var(--dm-text-3);
  }
  .chev {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 16px;
    font-style: normal;
    color: var(--dm-text-3);
  }
}
.chart-box {
  position: relative;
  height: 100%;
  padding: 0 10px;
}
</style>
