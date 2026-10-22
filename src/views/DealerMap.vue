<template>
  <div class="screen">
    <!-- 地图（主视图，全屏，不缩放） -->
    <div ref="mapLayerEl" class="map-layer" :class="{ ready: mapReady || amapNotice }" :style="{ '--dm-scale-bottom': `${34 + 50 * scale}px` }">
      <AmapView
        v-if="AMapRef"
        ref="mapView"
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
        @district-tap="revealUnlocated"
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
        <!-- 与登录舞台同一片灯光、同一位置：登录 → 地图交叉淡化时灯光接上，瓦片就绪后整罩淡出露出真地图 -->
        <LightsCanvas class="boot__lights" :k="scale" />
        <div class="boot__mid" :style="{ right: `${avoid.right}px` }">
          <BrandLogo v-if="brand" :name="brand.name" :height="40" class="boot__logo" />
          <span class="boot__ring" />
          <span class="boot__text">{{ bootText }}</span>
        </div>
      </div>
    </transition>

    <!-- 叠加界面层：按 1920×1080 设计稿与详情页同比例缩放；层本身透明且不接收鼠标 -->
    <div class="ui" :class="{ compact }" :style="uiStyle">
      <header class="topbar">
        <div class="brand">
          <transition name="fade" mode="out-in">
            <!-- 资料返回前就显示登录品牌的 logo（0.35 透明度），返回后淡到 1；不是空白占位 → logo 的跳变 -->
            <span v-if="topLogo" key="logo" class="brand__logo" :class="{ pending: !profileLoaded }">
              <h1 class="sr-only">{{ scopeTitle }}</h1>
              <BrandLogo :name="topLogo" :height="32" />
            </span>
            <span v-else-if="!profileLoaded" key="ph" class="brand__ph" />
            <h1 v-else key="txt" class="brand__txt">{{ scopeTitle }}</h1>
          </transition>
          <span class="brand__sep" />
          <CityPicker
            v-if="cityOptions.length > 1 || regionFilter"
            ref="cityPicker"
            variant="title"
            :model-value="regionFilter"
            :options="cityPickerOptions"
            label="城市"
            @update:model-value="changeRegion"
          />
          <span v-else-if="cityName" class="brand__city">{{ cityName }}</span>
          <CityPicker
            v-if="distributorOptions.length > 1"
            ref="distPicker"
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
          <!-- 展厅巡览：点按 = 立即开始；没有「停止」—— 任何触摸就是停止。1350（compact）下等顶栏减负（第 8 条）后再显示 -->
          <button v-if="tourCfg.enabled && AMapRef && !compact" class="tour-btn" title="开始自动巡览" aria-label="开始自动巡览" @click="tour.start()">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
          </button>
          <div class="clock">
            <b>{{ clock.time }}</b><small>{{ clock.date }}</small>
          </div>
          <div class="user" :title="`${userName}（${scopeHint}）`">
            <span class="user__name">{{ userName || '…' }}</span>
          </div>
          <div class="seg seg--theme" role="group" aria-label="主题">
            <button :class="{ on: theme === 'dark' }" :aria-pressed="theme === 'dark'" @click="switchTheme('dark', $event.currentTarget)">深色</button>
            <button :class="{ on: theme === 'light' }" :aria-pressed="theme === 'light'" @click="switchTheme('light', $event.currentTarget)">亮色</button>
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

      <!-- 巡览胶囊（不接收点按：任何点按都由 window 捕获退出巡览） -->
      <transition name="chip">
        <div v-if="tour.chip.show" class="tour-chip" :class="{ alarm: tour.chip.alarm }" role="status" aria-live="polite">
          <i class="tour-chip__dot" aria-hidden="true" />
          <span v-if="!tour.chip.alarm" class="tour-chip__lead">自动巡览中 · 触摸任意处退出</span>
          <span v-if="!tour.chip.alarm" class="tour-chip__sep" aria-hidden="true" />
          <span class="tour-chip__labels">
            <span :class="{ on: tour.chip.cur === 'a' }">{{ tour.chip.a }}</span>
            <span :class="{ on: tour.chip.cur === 'b' }">{{ tour.chip.b }}</span>
          </span>
        </div>
      </transition>

      <!-- 图例：随模式切换 -->
      <div class="legend">
        <template v-if="mode === 'markers'">
          <span v-for="(st, k) in STATES" :key="k"><i class="dot" :style="{ '--c': st.color }" />{{ k === 'offline' ? '全部离线' : st.label }}</span>
          <span class="help" :class="{ open: helpOpen }" tabindex="0" role="button" aria-label="说明" @click="helpOpen = !helpOpen" @blur="helpOpen = false" @keydown.enter.prevent="helpOpen = !helpOpen" @keydown.esc="helpOpen = false">?<em>区县圈 = 该区全部项目；放大后显示已确认位置的小区，相邻的合并成一个圈（双环 = 多个小区合并，点击继续放大）；14 级以上显示小区名；灰色 = 圈内项目全部离线（部分离线见弹窗）</em></span>
        </template>
        <template v-else>
          <span class="heat-title">{{ (theme === 'light' ? '深浅' : '亮度') + (heatMetric === 'alarms' ? ' = 一级告警数（10 天）' : ' = 小区内项目数') }}</span>
          <span v-for="t in heatTiers" :key="t.label" class="sw"><i :style="{ background: t.color }" />{{ t.label }}</span>
        </template>
      </div>

      <!-- 地图右下状态行 -->
      <div class="status">
        <span v-if="AMapRef && geoPending > 0" class="ring" />
        <template v-if="allProjects.length">已上图 {{ fmtNumber(locatedCount) }} / {{ fmtNumber(communityCount) }} 小区<template v-if="onlineLine"> · {{ onlineLine }}</template><template v-if="alarmLine"> · <em :class="alarmLine.cls">{{ alarmLine.text }}</em></template></template>
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
            <em v-if="activeAlarmCount && !alarmError" class="pill">进行中 {{ activeAlarmCount }}</em>
            <small v-if="alarmsLoaded && allProjects.length && !alarmError">近 10 天 {{ fmtNumber(alarmJoined.length) }} 条</small>
          </template>
          <!-- 明确的错误态（不是「近 10 天无一级告警」）：数据过期 / 从未取到 → 警示块；无权限 → 灰字 -->
          <div v-if="alarmError && alarmErrorKind !== 'forbidden'" class="alarm-err" role="status">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M12 10v4.2M12 16.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            <b>告警数据无法更新</b><small>{{ alarmError }}</small>
          </div>
          <p v-else-if="alarmError" class="muted">{{ alarmError }}</p>
          <ul v-else-if="alarmFeed.length" ref="feedEl" class="alarms" :class="{ aged: alarmAged }">
            <!-- 沿用 ≥ 5 分钟：顶部灰条（吸顶），下面的行变淡 -->
            <li v-if="alarmAged" class="alarm-aged" role="status">自 {{ alarmUpdated }} 起无法更新告警</li>
            <li
              v-for="a in alarmFeed"
              :key="a.id"
              :class="{ on: a.active, fresh: a.fresh, off: !a.located, flash: flashId === a.id, 'tour-on': tourRow?.alarmId === a.id }"
              :data-aid="a.id"
              :title="a.located ? `${fmtAbs(a.ts)} · 点击定位到小区` : `${fmtAbs(a.ts)} · 该小区尚未定位，点击查看项目详情`"
              tabindex="0"
              role="button"
              @click="tapAlarm(a)"
              @keydown.enter.prevent="tapAlarm(a)"
            >
              <!-- 整行是点按目标（电视规则）：已定位 → 飞到小区；未定位 → 项目详情 -->
              <span class="l1"><b class="name">{{ a.label }}</b><small>{{ a.district }}</small><em v-if="!a.located" class="unloc">未定位</em><span class="t">{{ fmtRel(a.ts) }}</span></span>
              <span class="l2"><span v-marquee class="meta"><span>{{ a.text }}</span></span><em v-if="a.tag" class="tag" :class="{ 'tag--on': a.active }">{{ a.tag }}</em></span>
              <i class="chev" aria-hidden="true">›</i>
            </li>
          </ul>
          <div v-else-if="alarmsLoaded" class="ok">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#00e2a1" stroke-width="1.6" /><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#00e2a1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <b>近 10 天无一级告警</b><small>系统运行正常</small>
          </div>
        </TechPanel>

        <TechPanel class="p-area" :loading="loading && !allProjects.length">
          <template #title>
            {{ cityName ? `${cityName} · 各区项目` : '各区项目' }}
            <!-- 全部城市：面板只列主城市，写明「本城 / 全部」，与 KPI 项目数的关系一目了然 -->
            <small v-if="areaTotal.show">{{ fmtNumber(areaTotal.city) }} / {{ fmtNumber(areaTotal.all) }}</small>
          </template>
          <!-- 全部区县直接列出（紧凑行高）；放不下时面板内滚动（滚轮不会缩放地图） -->
          <div v-if="areaRows.length" ref="rowsEl" class="rows">
            <div v-for="r in areaRows" :key="r.name" class="row" :class="{ 'row--none': r.none, 'tour-on': !r.none && tourRow?.district === r.name }">
              <span class="name">{{ r.name }}</span>
              <span class="track"><i v-if="!r.none" :style="{ width: r.pct + '%' }" /></span>
              <span class="val">{{ fmtNumber(r.count) }}</span><span class="area">{{ fmtArea(r.area) }}</span>
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
import { ref, shallowRef, computed, reactive, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import TechPanel from '@/components/TechPanel.vue'
import CityPicker from '@/components/CityPicker.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import LightsCanvas from '@/components/LightsCanvas.vue'
import { useScreenScale } from '@/composables/useScreenScale'
import { brandFor, defaultBrand } from '@/config/brand'
import EChart from '@/components/EChart.vue'
import AmapView from '@/components/AmapView.vue'
import FallbackMap from '@/components/FallbackMap.vue'
import { listAlarms, listOnlineProjectIds, me, getDistributor, pickProjectEndpoint, projectPage, listAllProjects, listProjectsLegacy } from '@/api'
import { toLogin, errorText } from '@/api/http'
import { toProject, mergeDeveloperAliases } from '@/geo/model'
import { mergeProjects } from '@/api/merge'
import { takePrefetch } from '@/api/prefetch'
import { loadShared, postShared } from '@/geo/shared'
import { hasAmapKey, loadAmap } from '@/geo/amap'
import { loadOverrides, loadSeed, lookupLocal, createGeocodeQueue, jitter } from '@/geo/geocoder'
import { regionInfo } from '@/utils/region'
import { STATES, applyStates, alarmStates, isActiveAlarm, alarmTag, alarmCount } from '@/geo/states'
import { useTour, tourConfig } from '@/composables/useTour'
import { planTour, cityChip, newAlarms } from '@/geo/tourPlan'
import { createAlarmTracker, retryDelay } from '@/geo/alarmPoll'
import { applyOnline, groupsOnlineStats, createOnlineTracker, sane } from '@/geo/online'
import { fmtNumber, fmtArea } from '@/utils/format'
import { tooltipStyle, categoryAxis, valueAxis, isLight } from '@/utils/chartTheme'
import { vMarquee, alarmText } from '@/directives/marquee'
import { theme, switchTheme } from '@/composables/useTheme'

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
// 亮色「墨染」：赭石由浅到深（§2.3）；告警口径同一套
const HEAT_TIERS_LIGHT = [
  { label: '1', color: '#ecdcc2' },
  { label: '2–4', color: '#ddbb86' },
  { label: '5–9', color: '#c99a52' },
  { label: '10–19', color: '#a86a18' },
  { label: '20+', color: '#7a480a' },
]
const heatTiers = computed(() => (theme.value === 'light' ? HEAT_TIERS_LIGHT : HEAT_TIERS))

const router = useRouter()
const route = useRoute()

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
const alarmUpdated = ref('') // 最后一次成功的 hh:mm
const alarmStale = ref(false) // 最近一次失败、沿用旧数据中（≤ 30 分钟）
const alarmAged = ref(false) // 沿用已 ≥ 5 分钟：面板顶部灰条 + 列表变淡
const alarmErrorKind = ref('')
// 状态行告警段：正常「告警 hh:mm 更新」；沿用中「告警 hh:mm 未更新」（警示色）；过期「告警 hh:mm 起未更新」；从未成功过不显示
const alarmLine = computed(() => {
  if (!alarmUpdated.value || alarmErrorKind.value === 'forbidden') return null
  if (alarmErrorKind.value) return { text: `告警 ${alarmUpdated.value} 起未更新`, cls: 'st-err' }
  if (alarmStale.value) return { text: `告警 ${alarmUpdated.value} 未更新`, cls: 'st-warn' }
  return { text: `告警 ${alarmUpdated.value} 更新`, cls: '' }
})
const alarmStateMap = computed(() => alarmStates(alarms.value))
const focus = shallowRef(null)
const fit = shallowRef(null)
const heatMetric = ref('projects')
let alarmTimer = null
let alarmOkNow = 0 // 最近一次成功轮询的时刻（新告警判定用）
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
// 失败不清数据（geo/alarmPoll.js）：30 分钟内沿用 + 「告警 hh:mm 未更新」（5 分钟起面板灰条）；之后清空并显示明确的错误态；403 立即清空
const alarmTracker = createAlarmTracker()
let alarmInflight = null
let alarmRetry = 0
function applyAlarmView(v) {
  alarmOkNow = v.okAt
  if (alarms.value !== v.alarms) alarms.value = v.alarms
  alarmUpdated.value = v.okAt ? hhmm(new Date(v.okAt)) : ''
  alarmStale.value = Boolean(v.staleSince) && !v.error
  alarmAged.value = v.aged
  alarmErrorKind.value = v.error
  alarmError.value =
    v.error === 'forbidden' ? '当前账号无告警查看权限' : v.error === 'expired' ? `自 ${alarmUpdated.value} 起未取到新数据，正在自动重试` : v.error === 'failed' ? '告警加载失败，正在自动重试' : ''
}
let disposed = false
function loadAlarms() {
  if (alarmInflight || disposed) return alarmInflight
  clearTimeout(alarmRetry)
  alarmRetry = 0
  alarmInflight = (async () => {
    let v
    try {
      const list = await listAlarms({ level: '1', days: 10 })
      if (disposed) return
      v = alarmTracker.ok(list)
    } catch (e) {
      if (disposed) return
      // 403 到这里已是「续期后重试仍 403」= 真无权限
      v = alarmTracker.fail(e?.response?.status)
      // 单独退避重试（10 → 20 → 40 → 60 s），不等整个 60 秒周期；无权限不重试
      if (v.error !== 'forbidden') alarmRetry = setTimeout(loadAlarms, retryDelay(v.fails))
    }
    applyAlarmView(v)
    alarmsLoaded.value = true
  })().finally(() => (alarmInflight = null))
  return alarmInflight
}
// ---------- 在线状态（与告警同节奏 60 秒刷新），docs/fable-offline.md ----------
// 失败 / 返回空：沿用上一次结果最多 5 分钟（状态行提示「未更新」），之后 = 未知（不判任何项目离线，永不全灰）。
// 标记变灰要连续 2 次成功轮询都离线（geo/online.js）；弹窗行点即时变。
const onlineTracker = createOnlineTracker()
const onlineRaw = shallowRef(null)
const onlineLoaded = ref(false)
async function loadOnline() {
  let set = null
  try {
    set = await listOnlineProjectIds()
  } catch (e) {
    console.warn('在线状态获取失败', e?.response?.status || e?.message)
  }
  onlineRaw.value = onlineTracker.update(set)
  onlineLoaded.value = true
}
// 过期不只在请求返回时判断：每 15 秒按读取时刻检查一次（轮询卡住时 5 分钟后也会变未知）
const onlineExpiry = setInterval(() => {
  const v = onlineTracker.current()
  if (v !== onlineRaw.value) onlineRaw.value = v
  applyAlarmView(alarmTracker.current())
}, 15000)
// 与本账号项目一个都对不上 → 当未知
const onlineView = computed(() => sane(onlineRaw.value, allProjects.value))
let onlineInflight = null
// 常规 60 秒轮询：告警在退避重试中时由重试计时器负责（不打断 10 → 20 → 40 s 的节奏）；网络恢复 / 回到前台则强制立即刷新
function refreshStatus(force = true) {
  if (force || !alarmRetry) loadAlarms()
  if (!onlineInflight) onlineInflight = loadOnline().finally(() => (onlineInflight = null))
}
// 网络恢复 / 标签页回到前台：立即刷新告警与在线状态（不等下一个 60 秒周期）
const onNetBack = () => refreshStatus()
const onVisible = () => document.visibilityState === 'visible' && alarmsLoaded.value && refreshStatus()
window.addEventListener('online', onNetBack)
document.addEventListener('visibilitychange', onVisible)
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
// 只跟随地图页自己的路由：keep-alive 缓存时 useRoute() 指向当前页面（项目详情），没有 region，
// 若直接用会被当成「全部城市」——在后台重算全部城市的区县并重新适配视野，返回地图时视图被重置（标记 188 → 7）
const MAP_PATH = '/dealer-map'
const readRegion = () => (typeof route.query.region === 'string' ? route.query.region : '')
const regionFilter = ref(readRegion())
watch(
  () => [route.path, route.query.region],
  () => {
    if (route.path === MAP_PATH && regionFilter.value !== readRegion()) regionFilter.value = readRegion()
  }
)
// 默认城市 = 无锡市：每次登录 / 打开大屏都从无锡开始（「全部城市」可手动切换，本次会话内保持）；账号下没有无锡项目时退回全部城市
const DEFAULT_REGION = '320000/320200'
if (typeof route.query.region !== 'string') router.replace({ query: { ...route.query, region: DEFAULT_REGION } })
let defaultChecked = false
const scopeTitle = computed(() => distributor.value?.name || '项目分布大屏')
const topLogo = computed(() => (profileLoaded.value ? (brandFor(scopeTitle.value) ? scopeTitle.value : '') : brand ? brand.name : ''))
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

// 城市下拉：项目还没到时 cityOptions 为空，选中的城市（URL region）不在选项里会显示成「全部城市」——补一项按行政区划名显示
const cityPickerOptions = computed(() => {
  const opts = [{ value: '', label: '全部城市', count: allProjects.value.length }, ...cityOptions.value.map((c) => ({ value: c.region, label: c.name, count: c.count }))]
  const r = regionFilter.value
  if (r && !opts.some((o) => o.value === r)) {
    const name = regionInfo(r.split('/')[1])?.name
    if (name) opts.push({ value: r, label: name, count: 0 })
  }
  return opts
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

// 开发商前缀别名并到同区的短名小区（「路劲蠡湖院子」→「蠡湖院子」）：按全部项目算，筛选不影响分组 key
const namedProjects = computed(() => mergeDeveloperAliases(allProjects.value))
const cityProjects = computed(() => (regionFilter.value ? namedProjects.value.filter((p) => p.city === cityCode.value) : namedProjects.value))

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
  return applyOnline(applyStates(list, alarmStateMap.value), onlineView.value)
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
    // 别名并入的项目：把它的原名查询串补进组里（与 keywords 一一对应），已有的缓存 / 种子仍能命中
    if (p.aliasOf) {
      for (const [i, q] of p.queries.entries()) {
        if (g.queries.includes(q)) continue
        g.queries = [...g.queries, q]
        g.keywords = [...g.keywords, p.keywords[i]]
      }
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

// 缩小时按区县汇总：圈数 = 该区全部项目（含未定位，与右侧面板 / KPI 同口径）；points 只含已定位小区（点击放大用）
const districtMarkers = computed(() => {
  const m = new Map()
  for (const g of groups.value) {
    // 区县未填的项目不上图（否则会在城市中心画一个叫「区县未填」的圈，像一个地名）：它们在「各区项目」面板末行单列
    if (!g.areaDistrict) continue
    const k = g.areaDistrict
    let d = m.get(k)
    if (!d) {
      d = { key: k, lnglat: districtCenter(g.areaDistrict), label: g.districtName, projects: [], points: [], unlocated: 0, unlocatedProjects: [] }
      m.set(k, d)
    }
    d.projects.push(...g.projects)
    const ll = geoResults[g.key]?.lnglat
    if (ll) {
      d.points.push(ll)
      if (!d.lnglat) d.lnglat = ll
    } else {
      d.unlocated += g.projects.length
      d.unlocatedProjects.push(...g.projects)
    }
  }
  return [...m.values()].filter((d) => d.lnglat)
})

const fallbackPoints = computed(() =>
  groups.value.map((g) => ({ lnglat: fallbackPos(g), count: g.count, label: g.community || '未识别小区', sub: [`${g.districtName} · ${g.count} 个项目`, `面积 ${fmtNumber(g.area)} ㎡`, [...g.types].join(' / ')] }))
)

const geoDone = computed(() => groups.value.filter((g) => geoResults[g.key] || !g.queries.length).length)
const geoPending = computed(() => groups.value.length - geoDone.value)
// 「小区」统一口径 = 有小区名的组（KPI 小区数 / 状态行分母同源；「未识别小区」按项目单列的组不算）
const communityCount = computed(() => groups.value.filter((g) => g.community).length)
const locatedCount = computed(() => groups.value.filter((g) => g.community && geoResults[g.key]?.lnglat).length)

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
// 在线汇总（当前范围内的小区）：null = 未知
const onlineStats = computed(() => groupsOnlineStats(groups.value, onlineView.value))
// 状态行：在线 x / y（当前范围）；失败沿用中 → 加「在线状态 hh:mm 未更新」；未知 → 「在线状态未知」
const onlineLine = computed(() => {
  const v = onlineView.value
  if (!v) return onlineLoaded.value ? '在线状态未知' : ''
  const s = onlineStats.value
  const base = `在线 ${fmtNumber(s.online)} / ${fmtNumber(s.total)}`
  return v.stale ? `${base} · 在线状态 ${hhmm(new Date(v.updatedAt))} 未更新` : base
})
if (import.meta.env.DEV) {
  // 开发环境验证：只返回计数，不含 id / 名称
  window.__dmPoll = refreshStatus // 立即轮询一次（验证轮询不移动视野）
  window.__dmOnline = () => ({ ids: onlineView.value?.cur.size ?? null, stale: onlineView.value?.stale ?? null, projects: allProjects.value.length, scope: onlineStats.value, confirmedOffline: projects.value.filter((p) => p.offline).length })
}
const alarmJoined = computed(() => alarms.value.filter((a) => projectGroup.value.has(a.projectId)))
const activeAlarmCount = computed(() => alarmJoined.value.filter(isActiveAlarm).length)
const FEED_LIMIT = 100
const alarmSorted = computed(() => [...alarmJoined.value].sort((a, b) => isActiveAlarm(b) - isActiveAlarm(a) || b.ts - a.ts))
const feedRow = (a) => {
  const g = projectGroup.value.get(a.projectId)
  const active = isActiveAlarm(a)
  return { ...a, text: alarmText(a.device, a.content), active, tag: alarmTag(a), fresh: active && Date.now() - a.ts < 3600e3, key: g.key, label: g.community || '未识别小区', district: g.districtName, located: Boolean(geoResults[g.key]?.lnglat) }
}
// 列表只渲染前 100 条；点区县气泡要找的未定位告警排在 100 名外时，把它追加到末尾（pinnedAlarmId）
const pinnedAlarmId = ref(null)
const alarmFeed = computed(() => {
  const top = alarmSorted.value.slice(0, FEED_LIMIT)
  const pin = pinnedAlarmId.value != null && alarmSorted.value.slice(FEED_LIMIT).find((a) => a.id === pinnedAlarmId.value)
  return (pin ? [...top, pin] : top).map(feedRow)
})
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
function tapAlarm(a) {
  a.located ? focusAlarm(a) : openProject(a.projectId)
}
// 点区县气泡：该区有「未定位小区」的告警时（地图上放大后看不到它们），在告警列表里滚到第一条并闪一下，
// 行本身就是入口（未定位 → 项目详情）
const feedEl = ref(null)
const flashId = ref(null)
let flashTimer = 0
async function revealUnlocated(d) {
  if (!d?.unlocatedAlarms) return
  // 在全部告警（不只是渲染的前 100 条）里找：同排序，进行中优先
  const unloc = (x) => {
    const g = projectGroup.value.get(x.projectId)
    return g.districtName === d.label && !geoResults[g.key]?.lnglat
  }
  const a = alarmSorted.value.find((x) => unloc(x) && isActiveAlarm(x)) || alarmSorted.value.find(unloc)
  if (a) showAlarm(a.id)
}
// 告警列表滚到某条（在前 100 条外则追加到末尾），flash = 闪 3 次（「现在看这里」）；scroll = false 只闪不滚
async function showAlarm(id, { flash = true, scroll = true } = {}) {
  if (id == null || !feedEl.value) return
  if (!alarmFeed.value.some((x) => x.id === id)) {
    if (!alarmSorted.value.some((x) => x.id === id)) return
    pinnedAlarmId.value = id
    await nextTick()
  }
  const ul = feedEl.value
  if (!ul) return
  const li = ul.querySelector(`[data-aid="${CSS.escape(String(id))}"]`)
  if (li && scroll) ul.scrollTo({ top: Math.max(0, li.offsetTop - ul.clientHeight / 2 + li.offsetHeight / 2), behavior: reducedMotion() ? 'auto' : 'smooth' })
  if (!flash) return
  flashId.value = id
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashId.value = null), 2400)
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
function focusAlarm(a) {
  if (!a.located) return
  mode.value = 'markers'
  focus.value = { key: a.key, n: Date.now() }
}

// ---------- 展厅待机巡览（docs/fable-autotour.md） ----------
const mapView = ref(null)
const mapLayerEl = ref(null)
const cityPicker = ref(null)
const distPicker = ref(null)
const rowsEl = ref(null)
const tourRow = shallowRef(null) // { district, alarmId }：面板行 / 告警行高亮（只存 id）
const tourCfg = tourConfig({ search: location.search, hash: location.hash, storage: typeof localStorage === 'undefined' ? null : localStorage })
// 告警数据能不能当故事讲：沿用 ≥ 5 分钟（aged）/ 错误态 → 不能（规模剧本、无告警热力）
const alarmsUsable = () => alarmsLoaded.value && !alarmAged.value && !alarmErrorKind.value
let tourReadyAt = 0
function tourCanStart() {
  const ready = Boolean(AMapRef.value && mapView.value && mapReady.value && communities.value.length > 0)
  if (ready && !tourReadyAt) tourReadyAt = performance.now()
  const ok =
    ready &&
    route.path === MAP_PATH &&
    document.visibilityState === 'visible' &&
    !loadError.value &&
    !document.documentElement.classList.contains('theme-vt') &&
    (alarmsLoaded.value || performance.now() - tourReadyAt >= 8000) // 告警还没到：最多等 8 s，之后按「不可用」讲规模
  const reading = mapView.value?.popOpenedBy() === 'user' || Boolean(cityPicker.value?.isOpen?.()) || Boolean(distPicker.value?.isOpen?.()) || helpOpen.value
  return { ok, reading }
}
function tourPlanNow() {
  const p = planTour({ districts: districtMarkers.value, communities: communities.value, cityCode: cityCode.value, alarmsUsable: alarmsUsable(), sameCity })
  const inCity = projects.value.filter((x) => x.city === cityCode.value)
  const comms = groups.value.filter((g) => g.community && g.city === cityCode.value).length
  return { ...p, city: cityChip({ story: p.story, cityName: cityName.value, projects: inCity.length, communities: comms, activeAlarms: alarmCount(inCity) }) }
}
// 面板行高亮：只在面板内滚到可见（不用 scrollIntoView —— 它会连带滚动 overflow:hidden 的外层）
function setTourRow(r) {
  tourRow.value = r
  if (!r?.district) return
  nextTick(() => {
    const row = rowsEl.value?.querySelector('.row.tour-on')
    let box = row?.parentElement
    while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement
    if (!row || !box || !box.closest('.p-area')) return
    const rt = row.getBoundingClientRect()
    const bt = box.getBoundingClientRect()
    const delta = rt.top < bt.top ? rt.top - bt.top - 8 : rt.bottom > bt.bottom ? rt.bottom - bt.bottom + 8 : 0
    if (delta) box.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' })
  })
}
let dipTimer = 0
const tour = useTour({
  enabled: tourCfg.enabled,
  idleMs: tourCfg.idleMs,
  map: () => mapView.value,
  canStart: tourCanStart,
  plan: tourPlanNow,
  getMode: () => mode.value,
  setMode: (m) => (mode.value = m),
  getMetric: () => heatMetric.value,
  setMetric: (m) => (heatMetric.value = m),
  setRow: setTourRow,
  revealUnlocated,
  showAlarm,
  closeOverlays: () => {
    mapView.value?.closePop()
    cityPicker.value?.close?.()
    distPicker.value?.close?.()
    helpOpen.value = false
  },
  reduced: reducedMotion,
  // 减少动态：镜头瞬移，地图层一暗一亮（150 + 150 ms）代替移动
  dip: () => {
    const el = mapLayerEl.value
    if (!el) return
    el.classList.add('tour-dip')
    clearTimeout(dipTimer)
    dipTimer = setTimeout(() => el.classList.remove('tour-dip'), 150)
  },
})
onActivated(() => tour.setActive(true))
onDeactivated(() => tour.setActive(false))
// ?tour=now：首批标记就绪后立即开始一轮（之后按正常空闲规则）
let tourNowTimer = 0
if (tourCfg.now) {
  const t0 = performance.now()
  const tryNow = () => {
    tourNowTimer = 0
    if (disposed || tour.state.value !== 'idle' || tour.start()) return
    if (performance.now() - t0 < 60000) tourNowTimer = setTimeout(tryNow, 250)
  }
  tourNowTimer = setTimeout(tryNow, 250)
}

// 新一级告警（§5.4，与第 5 条 toast 共用判定）：id 未见过、进行中、一级、ts > 上次轮询 − 5 min；首轮不算；告警不可用时不算
let alarmSeen = new Set()
let alarmSeeded = false
let alarmPrevOk = 0
watch(alarms, (list) => {
  if (!alarmsUsable()) return // 过期 / 错误：不判也不更新「见过」（恢复后与恢复前比）
  const fresh = alarmSeeded ? newAlarms(list, alarmSeen, alarmPrevOk).filter((a) => projectGroup.value.has(a.projectId)) : []
  alarmSeen = new Set(list.map((a) => a.id))
  alarmSeeded = true
  alarmPrevOk = alarmOkNow
  if (fresh.length) announceAlarms(fresh)
})
function announceAlarms(fresh) {
  const a = fresh[0] // ts 最新的一条
  const g = projectGroup.value.get(a.projectId)
  const located = Boolean(geoResults[g.key]?.lnglat)
  const head = fresh.length > 1 ? `${fresh.length} 条新一级告警 · 显示最新` : '新一级告警'
  const chip = `${head} · ${g.community || '未识别小区'} · ${alarmText(a.device, a.content)}${located ? '' : '（未定位）'}`
  // 巡览中：插播；否则只在列表里闪那一行，不动视野、不滚列表
  if (!tour.interrupt({ key: g.key, located, district: g.districtName, alarmId: a.id, chip })) showAlarm(a.id, { flash: true, scroll: false })
}
if (import.meta.env.DEV) {
  // 开发环境：巡览状态 / 手动开始停止 / 注入一条新一级告警（located: false → 注入到未定位小区）
  window.__dmTour = {
    get state() {
      return tour.state.value
    },
    get step() {
      return tour.step.value
    },
    get plan() {
      return tour.debug().plan
    },
    get chip() {
      return { ...tour.chip, text: tour.chip[tour.chip.cur] }
    },
    debug: () => tour.debug(),
    start: () => tour.start(),
    stop: () => tour.stop('dev'),
    inject({ located = true, key = '' } = {}) {
      const g = groups.value.find((x) => (key ? x.key === key : Boolean(geoResults[x.key]?.lnglat) === located && x.community))
      if (!g) return null
      const a = { id: `dev-${Date.now()}`, projectId: g.projects[0].id, level: 1, status: 1, ts: Date.now(), end: 0, device: '空气处理机(122)', content: '通讯故障（模拟）' }
      alarms.value = [a, ...alarms.value]
      return { key: g.key, label: g.community, id: a.id }
    },
  }
}

// ---------- KPI（数值 400ms 缓动） ----------
const sum = (k) => projects.value.reduce((s, p) => s + (Number(p[k]) || 0), 0)
const kpiRaw = computed(() => ({
  projects: projects.value.length,
  communities: communityCount.value,
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
// 加载罩文字：有总数后写进度
const bootText = computed(() => {
  const n = allProjects.value.length
  if (totalVisible.value && n < totalVisible.value) return `已加载 ${fmtNumber(n)} / ${fmtNumber(totalVisible.value)} 个项目`
  return loading.value ? '正在加载项目数据…' : '正在加载地图…'
})
const kpiSub = computed(() => {
  if (!allProjects.value.length) return '' // 加载中不写「共 0」
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
  // 区县未填：放末行（灰字、无进度条），不参与排序 / 比例
  const none = m.get('none')
  m.delete('none')
  const rows = [...m.values()].sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...rows.map((r) => r.count))
  const out = rows.map((r) => ({ ...r, pct: Math.max(2, (r.count / max) * 100) }))
  if (none) out.push({ ...none, name: '区县未填', none: true })
  return out
})

const areaTotal = computed(() => {
  const city = areaRows.value.reduce((n, r) => n + r.count, 0)
  const all = projects.value.length
  return { show: !regionFilter.value && all > city, city, all }
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
  // 亮色（§2.4）：其余柱 #4b97ac、当前 #0e7490；轴字 #5b6b80；柱顶字 #3b4f6b
  const lt = isLight()
  const axisC = lt ? '#5b6b80' : '#8fb0d0'
  const barC = lt ? '#4b97ac' : 'rgba(53,212,255,0.55)'
  const curC = lt ? '#0e7490' : '#35d4ff'
  return {
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 34, right: 10, top: 18, bottom: 22 },
    tooltip: { ...tooltipStyle(), trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: categoryAxis({ data: timeStats.value.map((d) => (timeMode.value === 'month' ? d[0].slice(2) : d[0])), axisLabel: { color: axisC, fontSize: 12 } }),
    yAxis: valueAxis({ splitNumber: 3, axisLabel: { color: axisC, fontSize: 11 } }),
    series: [
      {
        type: 'bar',
        name: '新增项目',
        data: timeStats.value.map((d, i) => ({ value: d[1], itemStyle: { color: i === last ? curC : barC } })),
        barMaxWidth: 16,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        label: { show: timeStats.value.length <= 12, position: 'top', color: lt ? '#3b4f6b' : '#b7d3f0', fontSize: 11 },
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

// 登录页拿到 token 时已预热的请求（api/prefetch.js）：首次挂载取走复用
let pre = null
async function loadProfile() {
  const data = await (pre?.me || me())
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
      const onPage = (list, total) => {
        if (stale()) return
        totalVisible.value = parseInt(total, 10) || 0
        allProjects.value = mergeProjects(allProjects.value, list, seen, toProject)
        loading.value = false
      }
      // 首次加载复用登录时已开始的翻页（同一接口）；之后（重试 / 重新加载）正常请求
      const stream = pre?.projects
      if (pre) pre.projects = null
      if (stream && (await stream.endpointP.catch(() => null)) === endpoint) await stream.consume(onPage)
      else await listAllProjects(endpoint, { region: '', limit: PAGE_SIZE, concurrency: 3, isStale: stale, onPage })
      if (!stale()) {
        allProjects.value = mergeProjects([], allProjects.value, new Set()) // 收尾再按 id 去一次重
        totalVisible.value = allProjects.value.length
      }
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
    if (stale()) return
    allProjects.value = mergeProjects([], raw, new Set(), toProject)
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
  toLogin('已退出登录', 'info')
}

function reloadAll() {
  loadProjects()
  refreshStatus()
}

watch(regionFilter, async () => {
  if (FETCH_ALL && endpoint) {
    distributorFilter.value = ''
    return
  }
  await loadProjects()
})
watch(cityCode, (c) => loadGeojson(c))
// 全部加载完（不是第一页）再判断；按城市请求的旧接口返回 0 条时也退回全部城市
watch([loading, () => allProjects.value.length, totalVisible], ([l, n, total]) => {
  if (l || defaultChecked || (FETCH_ALL && endpoint && n < total)) return
  defaultChecked = true
  if (regionFilter.value === DEFAULT_REGION && !n) return changeRegion('')
  if (regionFilter.value === DEFAULT_REGION && !allProjects.value.some((p) => p.city === DEFAULT_REGION.split('/')[1])) changeRegion('')
})
watch(groups, geocodeGroups)
watch(distributorOptions, loadDistributorNames)

onMounted(async () => {
  // 并行：高德 JS、坐标缓存与账号资料同时开始；项目列表只依赖 /me（选接口）
  pre = takePrefetch()
  const amapP = initAmap()
  const geoP = Promise.all([loadOverrides(), loadSeed(), pre?.shared || loadShared()])
  try {
    await loadProfile()
  } catch (e) {
    profileLoaded.value = true
    loadError.value = `账号信息获取失败：${errorText(e)}`
  }
  refreshStatus()
  alarmTimer = setInterval(() => refreshStatus(false), 60000)
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
  disposed = true
  tour.dispose()
  clearTimeout(tourNowTimer)
  clearTimeout(dipTimer)
  clearInterval(clockTimer)
  clearInterval(onlineExpiry)
  clearInterval(alarmTimer)
  clearTimeout(alarmRetry)
  window.removeEventListener('online', onNetBack)
  document.removeEventListener('visibilitychange', onVisible)
  queue && queue.stop()
})
</script>

<style scoped lang="scss">
/* ---------- 亮色主题（docs/fable-light-theme.md §2.3）：只加覆盖，深色规则不动 ---------- */
:root[data-theme='light'] {
  .topbar {
    background: linear-gradient(180deg, rgba(238, 242, 246, 0.97) 0, rgba(238, 242, 246, 0.94) 72px, rgba(238, 242, 246, 0) 96px);
  }
  .seg {
    background: rgba(16, 33, 58, 0.06);
    button:hover:not(.on) {
      color: var(--dm-text);
      background: rgba(16, 33, 58, 0.06);
    }
    button.on {
      color: #fff;
    }
    button.on:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--dm-focus);
    }
  }
  .logout {
    color: var(--dm-text);
    background: rgba(16, 33, 58, 0.04);
    border-color: rgba(16, 33, 58, 0.14);
    &:hover,
    &:focus-visible {
      background: rgba(16, 33, 58, 0.08);
    }
  }
  .boot {
    background: radial-gradient(60% 70% at 50% 50%, rgba(14, 116, 144, 0.08), transparent 70%), rgba(238, 242, 246, 0.94);
    &__ring {
      border-color: rgba(14, 116, 144, 0.2);
      border-top-color: var(--dm-accent);
    }
  }
  .geo-bar {
    background: rgba(14, 116, 144, 0.12);
    i {
      background: linear-gradient(90deg, #1d6fd6, var(--dm-accent));
    }
  }
  .notice {
    color: var(--dm-warn-text);
    background: rgba(255, 250, 240, 0.96);
    border-color: rgba(161, 98, 7, 0.45);
    box-shadow: var(--dm-shadow);
    &--err {
      color: var(--dm-alarm-text);
      background: rgba(255, 243, 243, 0.96);
      border-color: rgba(215, 38, 61, 0.45);
    }
    button {
      color: var(--dm-text);
      background: rgba(16, 33, 58, 0.05);
      border-color: rgba(16, 33, 58, 0.2);
    }
  }
  /* 图例 / 状态行：实底白 + 阴影（标记从后面经过不透出） */
  .legend {
    background: var(--dm-panel-solid);
    box-shadow: var(--dm-shadow);
    .help em {
      background: rgba(255, 255, 255, 0.98);
      box-shadow: var(--dm-shadow-pop);
    }
    .sw i {
      box-shadow: inset 0 0 0 1px rgba(16, 33, 58, 0.12); /* 1px 边，内描不改尺寸 */
    }
  }
  .status {
    color: var(--dm-text-3);
    background: var(--dm-panel-solid);
    box-shadow: var(--dm-shadow);
    .ring {
      border-color: rgba(14, 116, 144, 0.25);
      border-top-color: var(--dm-accent);
    }
  }
  .kpis {
    box-shadow: var(--dm-shadow);
    .kpi {
      border-left-color: var(--dm-line-2);
      &:nth-child(n + 4) {
        border-top-color: var(--dm-line-2);
      }
      span {
        color: var(--dm-text-3);
      }
    }
    &.skel b {
      background-image: linear-gradient(90deg, rgba(16, 33, 58, 0.06), rgba(16, 33, 58, 0.12), rgba(16, 33, 58, 0.06));
    }
  }
  .ok svg * {
    stroke: var(--dm-ok);
  }
  /* 告警列表：已处理 / 已恢复不用 opacity（深墨 55% 只有 3.7:1），改颜色降档 */
  .alarms {
    li {
      border-bottom-color: var(--dm-line-2);
      &:hover {
        background: var(--dm-hover);
      }
      &:not(.on) {
        opacity: 1;
        .name {
          color: #5b6b80;
        }
        .l1 small,
        .t,
        .meta,
        .tag {
          color: #62728a;
        }
        .chev {
          color: #8a97a8;
        }
      }
      &.flash {
        animation-name: feed-flash-light;
      }
    }
    .l1 small {
      color: var(--dm-text-3);
    }
    .unloc {
      color: var(--dm-warn-text);
      background: rgba(161, 98, 7, 0.08);
      border-color: rgba(161, 98, 7, 0.4);
    }
    .tag--on {
      color: var(--dm-alarm-text);
    }
  }
  .tour-btn {
    color: var(--dm-text);
    background: rgba(16, 33, 58, 0.04);
    border-color: rgba(16, 33, 58, 0.14);
    &:hover,
    &:focus-visible {
      background: rgba(16, 33, 58, 0.08);
    }
  }
  .tour-chip {
    color: var(--dm-text-2);
    background: var(--dm-panel-solid);
    border-color: var(--dm-line);
    box-shadow: var(--dm-shadow);
    backdrop-filter: none;
    &__labels {
      color: var(--dm-text);
    }
  }
  .rows .row.tour-on {
    background: var(--dm-hover);
    box-shadow: inset 3px 0 0 var(--dm-accent), 0 -3px 0 var(--dm-hover), 0 3px 0 var(--dm-hover);
  }
  .alarms li.tour-on {
    background: var(--dm-hover);
  }
  .rows {
    .track {
      background: rgba(16, 33, 58, 0.08);
      i {
        background: #4b97ac;
      }
    }
    .row:first-child .track i {
      background: var(--dm-accent);
    }
  }
}
@keyframes feed-flash-light {
  50% {
    background: rgba(161, 98, 7, 0.12);
    box-shadow: inset 0 0 0 1px rgba(161, 98, 7, 0.5);
  }
}
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
  /* 灯光：与登录舞台同几何（左 62%、整高），透明度同舞台 */
  &__lights {
    position: absolute;
    left: 0;
    top: 0;
    width: 62%;
    height: 100%;
    opacity: 0.85;
  }
  /* 文字居中在侧栏左侧的地图区 */
  &__mid {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
  }
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
  /* 0–72 px 近乎实底（标记不再从时钟 / 分段按钮后面半透出来），72–96 px 才渐隐 */
  background: linear-gradient(180deg, rgba(4, 11, 24, 0.97) 0, rgba(4, 11, 24, 0.94) 72px, rgba(4, 11, 24, 0) 96px);
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
    transition: opacity 0.4s ease;
    &.pending {
      opacity: 0.35;
    }
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
  height: max(40px, calc(40px / var(--ui-scale, 1))); /* 缩放后屏幕上仍 ≥ 40 px */
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
  background: rgba(4, 11, 24, 0.9); /* 标记从图例后面经过时不透出来 */
  backdrop-filter: blur(8px);
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
  background: rgba(4, 11, 24, 0.9);
  border-radius: 6px;
  backdrop-filter: blur(8px);
  font-variant-numeric: tabular-nums;
  .ring {
    width: 12px;
    height: 12px;
    border: 1.5px solid rgba(53, 212, 255, 0.25);
    border-top-color: var(--dm-accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  em {
    font-style: normal;
  }
  /* 告警沿用中 / 过期：与在线状态「未更新」同一写法，警示色（两主题走 token，深色回退原警示黄 / 告警红） */
  .st-warn {
    color: var(--dm-warn-text, #ffc722);
  }
  .st-err {
    color: var(--dm-alarm-text, #ff7a7c);
  }
}

/* 顶栏分段按钮 36 → 40 px（电视点按目标；年 / 月 迷你分段不变） */
.controls .seg:not(.seg--mini) button {
  height: 40px;
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
.alarms.aged {
  li:not(.alarm-aged) {
    filter: opacity(0.7); /* 与已处理行的 opacity 叠乘，不覆盖 */
  }
  .alarm-aged {
    position: sticky;
    top: 0;
    z-index: 2;
    display: block;
    height: 28px;
    line-height: 28px;
    margin-bottom: 4px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--dm-text-3);
    background: var(--dm-panel-solid, rgba(20, 30, 50, 0.95));
    box-shadow: inset 0 0 0 100px color-mix(in srgb, var(--dm-text-3) 14%, transparent);
    cursor: default;
  }
}
.alarm-err {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 16px;
  text-align: center;
  color: var(--dm-warn-text, #ffc722);
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
@keyframes feed-flash {
  50% {
    background: rgba(255, 200, 80, 0.16);
    box-shadow: inset 0 0 0 1px rgba(255, 200, 80, 0.55);
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
    user-select: none; /* 整行是点按目标：抖动点按 / 长按不选中文字 */
    -webkit-user-select: none;
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
    &:focus-visible {
      outline: 2px solid var(--dm-accent);
      outline-offset: -2px;
    }
    &.flash {
      opacity: 1;
      animation: feed-flash 0.8s ease-in-out 3;
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
    flex: none;
    height: 18px;
    padding: 0 6px;
    font-size: 11px;
    font-style: normal;
    line-height: 16px;
    color: #ffc722;
    background: rgba(255, 199, 34, 0.1);
    border: 1px solid rgba(255, 199, 34, 0.45);
    border-radius: 3px;
  }
  .tag {
    flex: none;
    font-size: 11px;
    font-style: normal;
    color: var(--dm-text-3);
    &--on {
      color: #ff9a9b; // 处理中：仍是进行中告警
    }
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
.rows {
  padding: 4px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  .row {
    display: grid;
    /* 名称 | 条 | 项目数 | 面积：数和面积各占固定宽的右对齐列，条都结束在同一 x */
    grid-template-columns: 64px minmax(0, 1fr) 44px 74px;
    align-items: center;
    column-gap: 10px;
    font-size: 13px;
  }
  .name {
    color: var(--dm-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track {
    height: 8px;
    background: rgba(120, 170, 255, 0.08);
    border-radius: 4px;
    i {
      display: block;
      height: 100%;
      min-width: 4px;
      border-radius: 4px;
      background: rgba(53, 212, 255, 0.55);
      transition: width 0.4s ease;
    }
  }
  .row:first-child .track i {
    background: var(--dm-accent);
  }
  /* 区县未填：灰字、无进度条（两主题都走 token） */
  .row--none {
    .track {
      visibility: hidden;
    }
    .name,
    .val {
      color: var(--dm-text-3);
      font-weight: 400;
    }
  }
  .val {
    text-align: right;
    font: 600 14px/1 var(--dm-num);
    color: var(--dm-text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .area {
    text-align: right;
    font: 400 12px/1 var(--dm-font);
    color: var(--dm-text-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}
/* ---------- 展厅巡览 ---------- */
.map-layer.ready.tour-dip {
  opacity: 0.35;
  transition: opacity 0.15s;
}
.tour-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: max(40px, calc(40px / var(--ui-scale, 1)));
  height: max(40px, calc(40px / var(--ui-scale, 1)));
  padding: 0;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--dm-line);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover,
  &:focus-visible {
    background: rgba(255, 255, 255, 0.12);
    border-color: var(--dm-accent);
  }
  &:focus-visible {
    outline: 2px solid var(--dm-accent);
    outline-offset: 2px;
  }
}
.tour-chip {
  position: absolute;
  top: 108px;
  left: 24px;
  z-index: 11;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  max-width: calc(100% - 24px - 380px - 48px);
  padding: 0 14px;
  font: 13px var(--dm-font);
  color: #b7d3f0;
  white-space: nowrap;
  background: rgba(4, 11, 24, 0.9);
  border: 1px solid rgba(120, 170, 255, 0.2);
  border-radius: 20px;
  backdrop-filter: blur(8px);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  &__dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dm-accent);
    animation: breathe 1.6s ease-in-out infinite;
  }
  &.alarm &__dot {
    background: var(--dm-alarm);
  }
  &__sep {
    flex: none;
    width: 1px;
    height: 16px;
    background: var(--dm-line);
  }
  /* 标签换文字：两个 span 交叉淡入 200 ms（不在显示的那个绝对定位，不撑宽度、不做宽度动画） */
  &__labels {
    position: relative;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--dm-text);
    > span {
      transition: opacity 0.2s ease;
      opacity: 0;
      position: absolute;
      left: 0;
      top: 0;
    }
    > span.on {
      position: static;
      opacity: 1;
    }
  }
}
.chip-enter-active {
  transition: opacity 0.2s ease;
}
.chip-leave-active {
  transition: opacity 0.1s ease; /* 退出 ≤ 100 ms */
}
.chip-enter-from,
.chip-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .tour-chip__dot {
    animation: none;
  }
  .tour-chip__labels > span {
    transition: none;
  }
}
.rows .row.tour-on {
  /* 不改行高 / 列宽：横向外扩 8 px 画底色，左侧 3 px 竖条用内阴影 */
  margin: 0 -8px;
  padding: 0 8px;
  border-radius: 3px;
  background: rgba(53, 212, 255, 0.08);
  box-shadow: inset 3px 0 0 var(--dm-accent), 0 -3px 0 rgba(53, 212, 255, 0.08), 0 3px 0 rgba(53, 212, 255, 0.08);
}
.alarms li.tour-on {
  opacity: 1;
  background: rgba(53, 212, 255, 0.08);
}

.chart-box {
  position: relative;
  height: 100%;
  padding: 0 10px;
}
</style>
