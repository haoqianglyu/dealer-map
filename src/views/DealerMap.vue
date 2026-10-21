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
        :center="center"
      />
      <FallbackMap
        v-else
        :geojson="geojson"
        :map-name="geojson ? `city-${cityCode}` : ''"
        :district-stats="districtStats"
        :points="fallbackPoints"
      />
    </div>

    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="bar" />
        <h1>{{ scopeTitle }}</h1>
        <span class="city">{{ cityName || '—' }} · 项目分布</span>
      </div>
      <div class="controls">
        <label v-if="cityOptions.length > 1 || regionFilter">
          城市
          <select :value="regionFilter" @change="changeRegion($event.target.value)">
            <option value="">全部可见范围</option>
            <option v-for="c in cityOptions" :key="c.region" :value="c.region">{{ c.name }}（{{ c.count }}）</option>
          </select>
        </label>
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
        <button v-if="IS_DEV" class="logout" :class="{ on: simulate }" title="仅开发环境：注入假状态以检查告警样式" @click="simulate = !simulate">
          {{ simulate ? '关闭模拟状态' : '模拟状态' }}
        </button>
        <span class="clock">{{ clock }}</span>
        <span class="user" :title="scopeHint">{{ userName }}</span>
        <button class="logout" @click="logout">退出</button>
      </div>
    </header>

    <!-- 高德 Key 提示 -->
    <div v-if="amapNotice" class="notice">{{ amapNotice }}</div>

    <!-- 图例 + 定位进度 -->
    <div class="legend">
      <span v-for="(st, k) in STATES" :key="k"><i class="dot" :style="{ background: st.color }" />{{ st.label }}</span>
      <span><i class="dot approx" />虚线 = 区县中心（近似）</span>
      <span class="muted-l">缩放 ≥ 12 级显示小区</span>
      <span v-if="AMapRef && geoPending > 0" class="progress">定位中 {{ geoDone }}/{{ groups.length }}</span>
    </div>

    <!-- 侧栏 -->
    <aside class="side">
      <div v-if="loadError" class="card error">{{ loadError }}</div>

      <div class="card scope">
        <div>账号：{{ userName }}<span class="tag">{{ scopeKind }}</span></div>
        <div>
          已加载 {{ allProjects.length }} 个项目<template v-if="totalVisible > allProjects.length">（账号可见共 {{ totalVisible }} 个，{{ FETCH_ALL ? '' : '试用仅取第 1 页' }}）</template>
        </div>
      </div>

      <div class="kpis">
        <div v-for="k in kpis" :key="k.label" class="kpi">
          <b>{{ k.value }}</b><span>{{ k.label }}</span>
        </div>
      </div>

      <TechPanel title="各区项目" variant="13" :loading="loading" :background-color="PANEL_BG" :style="{ height: `${Math.max(150, districtStats.length * 24 + 72)}px` }">
        <div class="chart-box fill">
          <EChart v-if="districtStats.length" :option="districtOption" />
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

      <TechPanel title="最新项目" variant="13" :loading="loading" :background-color="PANEL_BG" style="height: 330px">
        <ul class="list">
          <li v-for="p in latest" :key="p.id">
            <span class="date">{{ p.created.slice(0, 10) }}</span>
            <span class="name">{{ p.community || '未识别小区' }}</span>
            <span class="meta">{{ p.districtName }} · {{ p.type }} · {{ p.area }}㎡</span>
          </li>
          <li v-if="!latest.length" class="empty">暂无项目</li>
        </ul>
      </TechPanel>

      <TechPanel :title="`待校正（${needFix.length}）`" variant="13" :background-color="PANEL_BG" style="height: 300px">
        <p v-if="!AMapRef" class="muted">接入高德 Key 后自动定位到小区；未能匹配的小区会列在这里。</p>
        <template v-else>
          <p class="muted">以下小区未精确匹配，暂显示在区县中心。可在 public/geo-overrides.json 中按「查询串 → [经度, 纬度]」校正。</p>
          <ul class="list fix">
            <li v-for="g in needFix" :key="g.key">
              <span class="name">{{ g.community || '名称无法识别小区' }}</span>
              <span class="meta">{{ g.districtName }} · {{ g.count }} 个 · {{ g.reason }}</span>
              <code v-if="g.queries[0]">{{ g.queries[0] }}</code>
            </li>
            <li v-if="!needFix.length" class="empty">全部已定位</li>
          </ul>
        </template>
      </TechPanel>
    </aside>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import TechPanel from '@/components/TechPanel.vue'
import EChart from '@/components/EChart.vue'
import AmapView from '@/components/AmapView.vue'
import FallbackMap from '@/components/FallbackMap.vue'
import { me, getDistributor, pickProjectEndpoint, projectPage, listAllProjects, listProjectsLegacy } from '@/api'
import { session } from '@/api/session'
import { useTokenRefresh } from '@/composables/useTokenRefresh'
import { toProject } from '@/geo/model'
import { hasAmapKey, loadAmap } from '@/geo/amap'
import { loadOverrides, lookupLocal, createGeocodeQueue, jitter } from '@/geo/geocoder'
import { regionInfo } from '@/utils/region'
import { STATES, applyStates, fakeStates } from '@/geo/states'
import { fmtNumber, fmtArea } from '@/utils/format'
import { tooltipStyle, categoryAxis, valueAxis, AXIS_LABEL_COLOR } from '@/utils/chartTheme'

const IS_DEV = import.meta.env.DEV
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
const simulate = ref(false)
const timeMode = ref('year')
const AMapRef = shallowRef(null)
const amapNotice = ref(hasAmapKey() ? '' : '缺少高德 Key：请在 .env.local 配置 VITE_AMAP_KEY / VITE_AMAP_SECURITY 后重启。当前以区县中心近似显示。')
const geoResults = reactive({}) // groupKey → { lnglat, level, source } | { fail, reason }
const overrides = shallowRef({})
let queue = null

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

const cityProjects = computed(() => allProjects.value.filter((p) => p.city === cityCode.value))

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
  return simulate.value ? applyStates(list, fakeStates(list)) : list
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

// 每个小区一个标记：精确坐标或区县中心兜底
const communities = computed(() =>
  groups.value.map((g) => {
    const r = geoResults[g.key]
    const exact = Boolean(r && r.lnglat)
    return {
      key: g.key,
      lnglat: exact ? r.lnglat : fallbackPos(g),
      exact,
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
const needFix = computed(() =>
  groups.value
    .filter((g) => !g.queries.length || geoResults[g.key]?.fail)
    .map((g) => ({ ...g, reason: g.queries.length ? geoResults[g.key].reason : '名称中没有可识别的小区名' }))
    .sort((a, b) => b.count - a.count)
)

// ---------- 统计 ----------
const kpis = computed(() => {
  const ps = projects.value
  const exact = groups.value.filter((g) => geoResults[g.key]?.lnglat).length
  return [
    { label: '项目数', value: fmtNumber(ps.length) },
    { label: '小区数', value: fmtNumber(groups.value.filter((g) => g.community).length) },
    { label: '建筑面积', value: fmtArea(ps.reduce((s, p) => s + p.area, 0)) },
    { label: '房间数', value: fmtNumber(ps.reduce((s, p) => s + p.rooms, 0)) },
    { label: '设备数', value: fmtNumber(ps.reduce((s, p) => s + p.devices, 0)) },
    { label: '小区定位率', value: AMapRef.value && groups.value.length ? `${Math.round((exact / groups.value.length) * 100)}%` : '—' },
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

const districtOption = computed(() => {
  const data = [...districtStats.value].reverse()
  return {
    grid: { left: 64, right: 40, top: 8, bottom: 8 },
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
        data: data.map((d) => d.count),
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

const latest = computed(() => [...projects.value].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 8))

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

async function loadProjects() {
  loading.value = true
  loadError.value = ''
  try {
    let raw
    if (endpoint && FETCH_ALL) {
      raw = await listAllProjects(endpoint, { region: regionFilter.value })
      totalVisible.value = raw.length
    } else if (endpoint) {
      const r = await projectPage(endpoint, { page: 1, limit: PAGE_SIZE, region: regionFilter.value })
      raw = r.list
      totalVisible.value = r.total
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

function geocodeGroups() {
  for (const g of groups.value) {
    if (geoResults[g.key] || !g.queries.length) continue
    const local = lookupLocal(g.queries, overrides.value)
    if (local) geoResults[g.key] = local
  }
  if (!queue) return
  const todo = groups.value.filter((g) => !geoResults[g.key] && g.queries.length && !g._queued)
  todo.forEach((g) => (g._queued = true))
  queue.add(todo)
}

async function initAmap() {
  if (!hasAmapKey()) return
  try {
    const AMap = await loadAmap()
    queue = createGeocodeQueue(AMap, {
      concurrency: 3,
      gap: 200,
      onResult: (g, res) => (geoResults[g.key] = res),
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
  const [ov] = await Promise.all([loadOverrides(), initAmap(), loadProjects()])
  overrides.value = ov
  loadGeojson(cityCode.value)
  geocodeGroups()
})

onBeforeUnmount(() => {
  clearInterval(clockTimer)
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
    color: #658bb4;
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

.legend {
  position: absolute;
  left: 24px;
  bottom: 22px;
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
    color: #5f86ad;
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
  color: #5f86ad;
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
    color: #658bb4;
    font-family: 'DIN Alternate', 'Bahnschrift', monospace;
  }
  .name {
    color: #fff;
  }
  .meta {
    grid-column: 2;
    color: #6f95bb;
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
}
</style>
