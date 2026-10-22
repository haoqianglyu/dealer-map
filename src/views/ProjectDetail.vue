<template>
  <div class="pd-screen">
  <div class="pd" :style="screenStyle">
    <!-- 页头：与 niuniu 相同结构（左 logo / 中标题 / 右 时间 + 返回上一页 + 退出登录） -->
    <header class="pd__head">
      <div class="pd__logo"><BrandLogo :name="brand" :height="38" /></div>
      <h1 class="pd__title">{{ brand }} · 项目详情</h1>
      <div class="pd__right">
        <span class="pd__clock">{{ clock }}</span>
        <button class="hbtn" @click="back">返回上一页</button>
        <button class="hbtn" @click="logout">退出登录</button>
      </div>
    </header>
    <div v-if="error" class="pd__error">{{ error }}</div>

    <!-- 布局与 niuniu room-detail 一致：左 6 / 右 4；左 1.5 / 2 / 2.5，右 2 / 2 / 2.5；gap 20 -->
    <div class="pd__body">
      <div class="col col--left">
        <!-- ProjectSum -->
        <section class="box p-sum">
          <BoxLoading :show="loading || (st[41] === 'loading' && !live[41])" />
          <div class="sum">
            <div class="sum__top">
              <div class="sum__name">{{ title }}</div>
              <!-- 一级告警（dealer-map 新增，标题行内紧凑条，不改变比例） -->
              <button ref="astripBtn" class="astrip" :class="{ on: activeAlarms > 0 }" :aria-expanded="alarmOpen" @click="toggleAlarms">
                一级告警 · 10天 · 进行中 {{ activeAlarms }}/{{ alarms.length }}
              </button>
              <span class="live">
                <i :class="['dot', online === true ? 'on' : online === false ? 'off' : '']" />
                {{ liveBusy ? '查询中…' : online === true ? `实时 ${fmtClock(liveAt)}` : online === false ? '现场设备未响应' : '' }}
                <button class="lbtn" :disabled="liveBusy" @click="refreshLive(true)">刷新</button>
              </span>
            </div>
            <div class="sum__body">
              <div class="sum__img"><img src="/building.svg" alt="" /></div>
              <div class="sum__cols">
                <div class="sum__col">
                  <div class="sum__h">项目信息</div>
                  <div class="kv"><span>项目等级:</span><b>{{ project?.level || '-' }}</b></div>
                  <div class="kv"><span>应用名称:</span><b>{{ project?.app_name || '-' }}</b></div>
                  <div class="kv"><span>系统版本:</span><b>{{ project?.app_version || '-' }}</b></div>
                </div>
                <div class="sum__div" />
                <div class="sum__col">
                  <div class="sum__h">室内数据</div>
                  <div class="kv"><span>温度:</span><b>{{ fmt(indoor.temperature, '°C') }}</b></div>
                  <div class="kv"><span>湿度:</span><b>{{ fmt(indoor.humidity, '%') }}</b></div>
                  <div class="kv"><span>PM2.5:</span><b>{{ fmt(indoor.pm25, 'μg/m³') }}</b></div>
                  <div class="kv"><span>CO₂:</span><b>{{ fmt(indoor.co2, 'ppm') }}</b></div>
                </div>
                <div class="sum__div" />
                <div class="sum__col">
                  <div class="sum__h">室外数据</div>
                  <div class="kv"><span>温度:</span><b>{{ fmt(outdoor.temperature, '°C') }}</b></div>
                  <div class="kv"><span>湿度:</span><b>{{ fmt(outdoor.humidity, '%') }}</b></div>
                  <div class="kv"><span>PM2.5:</span><b>{{ fmt(outdoor.pm25, 'μg/m³') }}</b></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 房间实时情况（RoomReal：每页 5 × 2，左右箭头翻页） -->
        <section class="box p-real">
          <BoxLoading :show="(st[40] === 'loading' || st[40] === 'idle') && !roomsLive.length" />
          <div class="rr">
            <div class="rr__title">房间实时情况</div>
            <div class="rr__content">
              <button v-if="roomsLive.length > 10" class="rr__nav l" :disabled="rrStart" aria-label="上一页" @click="rrScroll(-1)">‹</button>
              <div ref="rrEl" class="rr__wrap" @scroll="rrCheck">
                <div v-for="(page, pi) in roomPages" :key="pi" class="rr__page">
                  <div v-for="(r, i) in page" :key="r.id || i" class="rr__card" :class="{ on: r.panelSwitch === '开' }" :title="roomTitle(r)">
                    <div class="rr__head">
                      <span class="rr__id">{{ String(pi * 10 + i + 1).padStart(2, '0') }}</span>
                      <span class="rr__name">{{ r.name }}</span>
                    </div>
                    <div class="rr__body">
                      <div class="rr__item">
                        <div class="rr__icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0ZM12 4a1 1 0 0 1 1 1v6h-2V5a1 1 0 0 1 1-1Z" /></svg>
                        </div>
                        <div class="rr__label"><div class="zh">温度</div><div class="en">Temperature</div></div>
                        <div class="rr__val"><span class="num">{{ fmtNum(r.currentTemperature) }}</span><span class="unit">°C</span></div>
                      </div>
                      <div class="rr__item">
                        <div class="rr__icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z" /></svg>
                        </div>
                        <div class="rr__label"><div class="zh">湿度</div><div class="en">Humidity</div></div>
                        <div class="rr__val"><span class="num">{{ fmtNum(r.currentHumidity) }}</span><span class="unit">%</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="!roomsLive.length && st[40] !== 'loading' && st[40] !== 'idle'" class="rr__empty">暂无数据</div>
              </div>
              <button v-if="roomsLive.length > 10" class="rr__nav r" :disabled="rrEnd" aria-label="下一页" @click="rrScroll(1)">›</button>
            </div>
          </div>
        </section>

        <!-- RoomStats：左 24 小时房间数据统计 / 右 室内传感器数据 -->
        <section class="box p-stats">
          <div class="stats">
            <div class="stats__part">
              <BoxLoading :show="(st[41] === 'loading' || st[41] === 'idle') && !dayRows.length" />
              <div class="part-h"><span class="ttl">24小时房间数据统计</span></div>
              <div v-show="!((st[41] === 'loading' || st[41] === 'idle') && !dayRows.length)" class="tabs">
                <button v-for="k in ['平均温度', '平均露点']" :key="k" :class="{ on: dayMetric === k }" @click="dayMetric = k">{{ k }}</button>
              </div>
              <div class="chart">
                <EChart v-if="dayRows.length" :option="dayOption" />
                <div v-else-if="st[41] !== 'loading' && st[41] !== 'idle'" class="empty">暂无数据</div>
              </div>
            </div>
            <div class="stats__div" />
            <div class="stats__part">
              <BoxLoading :show="(sensorLoading || cfgLoading) && !daily.length" />
              <div class="part-h">
                <span class="ttl">室内传感器数据</span>
                <SmallSelect
                  v-if="sensors.length"
                  :model-value="sensorIdx"
                  :options="sensors.map((s, i) => ({ value: i, label: s.name }))"
                  :width="120"
                  label="传感器"
                  @update:model-value="(v) => (sensorIdx = v)"
                />
              </div>
              <div v-show="!((sensorLoading || cfgLoading) && !daily.length)" class="tabs">
                <button v-for="m in METRICS" :key="m.key" :class="{ on: metric === m.key }" @click="metric = m.key">{{ m.label }}</button>
              </div>
              <div class="chart">
                <EChart v-if="daily.length" :option="sensorOption" />
                <div v-else-if="!sensorLoading && !cfgLoading" class="empty">暂无数据</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="col col--right">
        <!-- 电表数据（按业主要求暂时留空框，不查询 44） -->
        <section class="box p-meter">
          <div class="series"><div class="part-h"><span class="ttl">电表数据</span></div></div>
        </section>

        <!-- 建筑能效（按业主要求留空框） -->
        <section class="box p-energy">
          <div class="series"><div class="part-h"><span class="ttl">建筑能效</span></div></div>
        </section>

        <!-- 设备运行系统（Equipments） -->
        <section class="box p-eq">
          <BoxLoading :show="cfgLoading" />
          <div class="series">
            <div class="part-h"><span class="ttl">设备运行系统</span></div>
            <div class="eq-wrap">
              <table class="eq">
                <thead>
                  <tr><th /><th>名称</th><th>设备 ID</th><th>设备类别</th><th>操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="e in eqShown" :key="e.id">
                    <td><i class="dot" :class="{ on: onlineIds.has(String(e.id)) }" :title="onlineIds.has(String(e.id)) ? '在线' : '离线/未知'" /></td>
                    <td>{{ e.name }}</td>
                    <td class="mono">{{ e.id }}</td>
                    <td>{{ e.category }}</td>
                    <td><button class="link" @click="openDevice(e)">查看数据&gt;</button></td>
                  </tr>
                  <tr v-if="!equipments.length && !cfgLoading"><td colspan="5" class="empty">暂无数据</td></tr>
                </tbody>
              </table>
            </div>
            <div class="pager">
              <span>Total {{ equipments.length }}</span>
              <button :disabled="eqPage <= 0" aria-label="上一页" @click="eqPage--">‹</button>
              <button v-for="n in eqPages" :key="n" :class="{ on: eqPage === n - 1 }" @click="eqPage = n - 1">{{ n }}</button>
              <button :disabled="eqPage >= eqPages - 1" aria-label="下一页" @click="eqPage++">›</button>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 一级告警列表（传送到 body，避免被面板裁切） -->
    <Teleport to="body">
      <ul v-if="alarmOpen" class="astrip__list" :style="alarmPos" @keydown.esc="alarmOpen = false">
        <li v-for="a in alarms" :key="a.id" :class="{ on: isActiveAlarm(a) }">
          <span class="t">{{ fmtTs(a.ts) }}</span>
          <span class="d">{{ a.device }}</span>
          <span class="c">{{ a.content }}<small>{{ isActiveAlarm(a) ? '进行中' : a.status === 1 ? '已恢复' : '已处理' }}</small></span>
        </li>
        <li v-if="!alarms.length" class="empty">10 天内无一级告警</li>
      </ul>
    </Teleport>

    <!-- 设备数据抽屉（niuniu Equipments「查看数据」） -->
    <aside v-if="drawer.open" class="drawer" role="dialog" :aria-label="drawer.title" @keydown.esc="drawer.open = false">
      <header>
        <b>{{ drawer.title }}</b>
        <button class="hbtn" @click="drawer.open = false">关闭</button>
      </header>
      <div v-if="drawer.loading" class="empty">请求数据中...</div>
      <div v-else-if="drawer.error" class="empty">{{ drawer.error }}</div>
      <div v-else class="drawer__grid">
        <template v-for="(it, i) in drawer.items" :key="i">
          <div v-if="it.value === undefined || it.value === null || it.value === ''" class="drawer__group">{{ it.title }}</div>
          <div v-else class="kv"><span>{{ it.title }}</span><b>{{ it.value }}</b></div>
        </template>
        <div v-if="!drawer.items.length" class="empty">暂无数据</div>
      </div>
    </aside>
  </div>
  </div>
</template>

<script setup>
// 项目二级界面：布局/板块/内容参照 niuniu room-detail（docs/drilldown-ref.md），配色用 dealer-map 主题。
// 实时数据走设备透传「查询」消息（41/40/44/43/30/15），只在打开本页时查询；页面可见时最多每 60 秒自动刷新一次。
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SmallSelect from '@/components/SmallSelect.vue'
import BoxLoading from '@/components/BoxLoading.vue'
import { useStretchScale } from '@/composables/useScreenScale'
import BrandLogo from '@/components/BrandLogo.vue'
import { session } from '@/api/session'
import EChart from '@/components/EChart.vue'
import * as echarts from 'echarts'
import { me, getDistributor, getProject, getProjectConfig, getDeviceDataList, getDeviceCategories, getDeviceModels, listAlarms } from '@/api'
import { ctrlQuery, DeviceTimeout } from '@/api/ctrl'
import { isActiveAlarm } from '@/geo/states'
import { regionInfo, parseRegion } from '@/utils/region'
import { tooltipStyle, categoryAxis, valueAxis } from '@/utils/chartTheme'
import { isShowroom, showName } from '@/utils/showroom'

defineOptions({ name: 'ProjectDetail' })
const { style: screenStyle } = useStretchScale() // 与 niuniu 一致：1920×1080 画布按 x/y 拉伸铺满一屏，不滚动
const clock = ref('')
const WEEK = '日一二三四五六'
function tickClock() {
  const d = new Date()
  clock.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 星期${WEEK[d.getDay()]} ${d.toTimeString().slice(0, 8)}`
}
tickClock()
const clockTimer = setInterval(tickClock, 1000)
const brand = ref('项目分布大屏')
function logout() {
  session.clear()
  router.replace('/login')
}
const SENSOR_MODEL = '620db09cdcae9b926dc804e1' // niuniu：室内传感器 model
// 曲线配色与 niuniu 相同：每个指标固定一种颜色，面积为同色 0.4 → 0.05 竖向渐变
const NIU = { blue: [24, 144, 255], green: [0, 201, 120], cyan: [0, 229, 255], yellow: [245, 194, 43], purple: [179, 127, 235] }
function lineStyleOf([r, g, b]) {
  const c = `rgb(${r}, ${g}, ${b})`
  return {
    itemStyle: { color: c },
    lineStyle: { width: 3, color: c },
    areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `rgba(${r}, ${g}, ${b}, 0.4)` }, { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0.05)` }]) },
  }
}
const DAY_COLOR = { 平均温度: NIU.blue, 平均露点: NIU.green }
const RANGE_COLOR = { datahour: NIU.blue, dataDay: NIU.green, dataMonth: NIU.yellow, dataYear: NIU.purple }
const METRICS = [
  { key: 'd1', label: '温度', unit: '°C', color: NIU.blue },
  { key: 'd2', label: '湿度', unit: '%', color: NIU.green },
  { key: 'd3', label: 'PM2.5', unit: 'μg/m³', color: NIU.cyan },
  { key: 'd4', label: 'CO₂', unit: 'ppm', color: NIU.purple },
]
const RANGES = [
  { key: 'datahour', label: '24小时' },
  { key: 'dataDay', label: '天/月' },
  { key: 'dataMonth', label: '月/年' },
  { key: 'dataYear', label: '年' },
]
const SERIES_BLOCKS = [
  { type: 44, title: '电表数据', cls: 'p-meter', empty: '暂无电表数据' },
  { type: 43, title: '建筑能效', cls: 'p-energy', empty: '暂无能效数据' },
]
const LIVE_INTERVAL = 60000

const route = useRoute()
const router = useRouter()
const showroom = isShowroom()
const projectId = String(route.params.id || '')
const project = ref(null)
const config = ref(null)
const loading = ref(true)
const error = ref('')
const alarms = ref([])
const categories = ref({})
const modelCat = ref({})
const userId = ref('')

const title = computed(() => (project.value ? showName(project.value.name) : '项目详情'))
const subtitle = computed(() => {
  const r = parseRegion(project.value?.customer_region || '')
  return [regionInfo(r.city)?.name, regionInfo(r.district)?.name, project.value?.building_type].filter(Boolean).join(' · ')
})
const z = (n) => String(n).padStart(2, '0')
const fmtTs = (ms) => {
  const d = new Date(ms)
  return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
}
const fmtClock = (ms) => {
  const d = new Date(ms)
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}
const fmt = (v, unit) => (v === undefined || v === null || v === '' || isNaN(v) ? '--' : `${(+v).toFixed(1)}${unit}`)

// ---------- 实时透传查询 ----------
// st[type]: 'idle' | 'loading' | 'ok' | 'timeout' | 'error'
const st = reactive({ 41: 'idle', 40: 'idle', 44: 'idle', 43: 'idle', 30: 'idle' })
const live = reactive({ 41: null, 40: null, 30: null })
const series = reactive({ 44: { list: [], range: 'datahour', idx: 0 }, 43: { list: [], range: 'datahour', idx: 0 } })
const liveAt = ref(0)
const liveBusy = ref(false)
const online = ref(null)
const stateNote = (s, emptyText = '') =>
  s === 'loading' || s === 'idle' ? '正在向现场设备查询…' : s === 'timeout' ? '现场设备未响应' : s === 'error' ? '查询失败' : emptyText

async function runQuery(type, opts = {}) {
  st[type] = 'loading'
  try {
    const r = await ctrlQuery(type, { projectId, userId: userId.value, ...opts })
    st[type] = 'ok'
    return r
  } catch (e) {
    st[type] = e instanceof DeviceTimeout ? 'timeout' : 'error'
    return null
  }
}
async function refreshLive(manual = true) {
  if (liveBusy.value || !project.value) return
  liveBusy.value = true
  // 电表/能效一旦超时，自动刷新不再重查（只在手动「刷新」时重试）
  const skip = (t) => !manual && st[t] === 'timeout'
  const [r41, r40, r44, r43, r30] = await Promise.all([
    runQuery(41),
    runQuery(40),
    null, // 电表数据：按业主要求暂不查询 44（Worker 仍放行，留待以后）
    null, // 建筑能效：按业主要求留空，不查询 43
    runQuery(30, { query: { projectId } }),
  ])
  if (r41) live[41] = r41
  if (r40) live[40] = r40
  if (r44) series[44].list = r44.dataList || []
  if (r43) series[43].list = r43.dataList || []
  if (r30) live[30] = r30
  online.value = [r41, r40, r44, r43, r30].some(Boolean)
  setTimeout(rrCheck, 50)
  liveAt.value = Date.now()
  liveBusy.value = false
}
let timer = null
function tick() {
  if (document.visibilityState === 'visible' && Date.now() - liveAt.value >= LIVE_INTERVAL - 1000) refreshLive(false)
}

const indoor = computed(() => live[41]?.indoorData || (latest.value ? { temperature: latest.value.d1, humidity: latest.value.d2, pm25: latest.value.d3, co2: latest.value.d4 } : {}))
const outdoor = computed(() => live[41]?.outdoorData || {})
const indoorNote = computed(() =>
  live[41]?.indoorData ? '实时' : latest.value ? `${stateNote(st[41])}；显示传感器最近上报 ${fmtTs(latest.value.timestamp * 1000)}` : stateNote(st[41])
)
const roomsLive = computed(() => live[40]?.data || [])
const roomPages = computed(() => {
  const out = []
  for (let i = 0; i < roomsLive.value.length; i += 10) out.push(roomsLive.value.slice(i, i + 10))
  return out
})
const fmtNum = (v) => (v === undefined || v === null || isNaN(v) ? '--' : (+v).toFixed(1))
const rrEl = ref(null)
const rrStart = ref(true)
const rrEnd = ref(false)
function rrCheck() {
  const e = rrEl.value
  if (!e) return
  rrStart.value = e.scrollLeft <= 0
  rrEnd.value = e.scrollLeft + e.clientWidth >= e.scrollWidth - 2
}
function rrScroll(dir) {
  const e = rrEl.value
  if (e) e.scrollBy({ left: dir * (e.clientWidth + 20), behavior: 'smooth' })
}
const alarmOpen = ref(false)
const astripBtn = ref(null)
const alarmPos = ref({})
function toggleAlarms() {
  const r = astripBtn.value?.getBoundingClientRect()
  if (r) alarmPos.value = { top: `${r.bottom + 4}px`, left: `${r.left}px` }
  alarmOpen.value = !alarmOpen.value
}
const roomTitle = (r) =>
  [['地暖温度', r.floorTemperature], ['顶棚阀', r.ceilingValve], ['地暖阀', r.floorValve], ['露点保护', r.dewPointProtection], ['风速', r.fanSpeed], ['通讯故障', r.communicationFault], ['传感器故障', r.sensorFault]]
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}：${v}`)
    .join('\n')
const onlineIds = computed(() => new Set((live[30]?.ids || []).map(String)))

// 24 小时房间数据统计（41.temperature：[{ time, value, type: 平均温度|平均露点 }]）
const dayMetric = ref('平均温度')
const dayRows = computed(() => (live[41]?.temperature || []).filter((t) => t.type === dayMetric.value))
const dayOption = computed(() => ({
  grid: { left: 40, right: 12, top: 14, bottom: 24 },
  tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: (v) => `${v}°C` },
  xAxis: categoryAxis({ data: dayRows.value.map((t) => t.time), boundaryGap: false }),
  yAxis: valueAxis({ scale: true }),
  series: [{ type: 'line', name: dayMetric.value, data: dayRows.value.map((t) => +(+t.value).toFixed(1)), smooth: dayRows.value.length >= 8 ? 0.4 : false, symbol: 'none', ...lineStyleOf(DAY_COLOR[dayMetric.value] || NIU.blue) }],
}))

// 电表 / 能效（niuniu 的横轴标签规则）
function rangeLabels(range, n) {
  const now = new Date()
  if (range === 'datahour') return Array.from({ length: n }, (_, i) => `${(now.getHours() - (n - i) + 48) % 24}时`)
  if (range === 'dataDay') return Array.from({ length: n }, (_, i) => `${new Date(now.getTime() - (n - i) * 86400000).getDate()}日`)
  if (range === 'dataMonth') return Array.from({ length: n }, (_, i) => `${((now.getMonth() - (n - i) + 24) % 12) + 1}月`)
  return Array.from({ length: n }, (_, i) => `${now.getFullYear() - (n - 1 - i)}年`)
}
function seriesOption(type) {
  const s = series[type]
  const d = s.list[s.idx] || s.list[0] || {}
  const vals = (d[s.range] || []).map((v) => +(+v).toFixed(2))
  return {
    grid: { left: 44, right: 12, top: 14, bottom: 24 },
    tooltip: { ...tooltipStyle, trigger: 'axis' },
    xAxis: categoryAxis({ data: rangeLabels(s.range, vals.length) }),
    yAxis: valueAxis({ scale: true, name: type === 44 ? '(kWh)' : '', nameTextStyle: { color: '#93b5d6', fontSize: 11 } }),
    series: [{ type: 'line', data: vals, smooth: true, symbolSize: 6, symbol: 'circle', ...lineStyleOf(RANGE_COLOR[s.range] || NIU.blue) }],
  }
}

// 设备数据抽屉（15 DeviceDataGetQuery）
const drawer = reactive({ open: false, title: '', loading: false, error: '', items: [] })
async function openDevice(e) {
  Object.assign(drawer, { open: true, title: e.name, loading: true, error: '', items: [] })
  try {
    const r = await ctrlQuery(15, { projectId, userId: userId.value, query: { deviceId: String(e.id) } })
    drawer.title = r.equipmentName || e.name
    drawer.items = r.data || []
  } catch (err) {
    drawer.error = err instanceof DeviceTimeout ? '现场设备未响应' : '查询失败'
  } finally {
    drawer.loading = false
  }
}

// ---------- 静态配置：设备清单 / 传感器历史 ----------
const equipments = computed(() => {
  const c = config.value
  if (!c) return []
  const list = []
  const cat = (item) => {
    const model = Array.isArray(item.model) && item.model.length ? item.model[item.model.length - 1] : null
    return categories.value[modelCat.value[model]] || '-'
  }
  for (const [k, v] of Object.entries(c)) {
    if (!Array.isArray(v) || /floorConfigModel/.test(k)) continue
    for (const it of v) if (it?.id && it?.name) list.push({ id: it.id, name: it.name, category: cat(it) })
  }
  return list
})
const eqPage = ref(0)
const EQ_PAGE = 5 // niuniu：每页 5 行
const eqPages = computed(() => Math.max(1, Math.ceil(equipments.value.length / EQ_PAGE)))
const eqShown = computed(() => equipments.value.slice(eqPage.value * EQ_PAGE, eqPage.value * EQ_PAGE + EQ_PAGE))

const sensors = computed(() => (config.value?.['传感器Model'] || []).filter((s) => JSON.stringify(s.model || '').includes(SENSOR_MODEL)))
const sensorIdx = ref(0)
const metric = ref('d1')
const sensorRows = ref([])
const sensorLoading = ref(false)
const cfgLoading = ref(true) // 项目配置 / 设备类别加载中（设备表、传感器列表依赖它）
const latest = computed(() => sensorRows.value.reduce((a, b) => (!a || Number(b.timestamp) > Number(a.timestamp) ? b : a), null))
const daily = computed(() => {
  const m = new Map()
  for (const it of sensorRows.value) {
    const d = new Date(Number(it.timestamp) * 1000)
    const k = `${d.getMonth() + 1}-${z(d.getDate())}`
    const o = m.get(k) || { k, t: Number(it.timestamp), n: 0, d1: 0, d2: 0, d3: 0, d4: 0 }
    for (const f of ['d1', 'd2', 'd3', 'd4']) o[f] += Number(it[f]) || 0
    o.n++
    m.set(k, o)
  }
  return [...m.values()].sort((a, b) => a.t - b.t).map((o) => ({ k: o.k, d1: +(o.d1 / o.n).toFixed(1), d2: +(o.d2 / o.n).toFixed(1), d3: +(o.d3 / o.n).toFixed(1), d4: +(o.d4 / o.n).toFixed(1) }))
})
const sensorOption = computed(() => {
  const m = METRICS.find((x) => x.key === metric.value)
  return {
    grid: { left: 44, right: 16, top: 16, bottom: 26 },
    tooltip: { ...tooltipStyle, trigger: 'axis', valueFormatter: (v) => `${v}${m.unit}` },
    xAxis: categoryAxis({ data: daily.value.map((d) => d.k) }),
    yAxis: valueAxis({ scale: true }),
    // 只画有数据的日期，直线连接真实点（不用样条，避免过冲）
    series: [{ type: 'line', name: m.label, data: daily.value.map((d) => d[m.key]), smooth: daily.value.length >= 8 ? 0.4 : false, symbol: daily.value.length >= 8 ? 'none' : 'circle', symbolSize: 6, ...lineStyleOf(m.color) }],
  }
})
async function loadSensor() {
  const s = sensors.value[sensorIdx.value]
  if (!s || !project.value) {
    sensorRows.value = []
    return
  }
  sensorLoading.value = true
  const end = Math.floor(Date.now() / 1000)
  try {
    sensorRows.value = await getDeviceDataList({ deviceId: s.id, projectId, start: end - 30 * 86400, end })
  } catch {
    sensorRows.value = []
  } finally {
    sensorLoading.value = false
  }
}
watch(sensorIdx, loadSensor)

const activeAlarms = computed(() => alarms.value.filter(isActiveAlarm).length)

function back() {
  // 地图页用 keep-alive 保留，返回即恢复原视图
  if (window.history.state?.back) router.back()
  else router.push('/dealer-map')
}

onMounted(async () => {
  document.documentElement.classList.add('pd-noscroll') // 本页 html/body 不出滚动条
  try {
    project.value = await getProject(projectId)
    if (!project.value) throw new Error('未找到该项目或无权限')
  } catch (e) {
    error.value = e?.message || '项目加载失败'
    loading.value = false
    cfgLoading.value = false
    return
  }
  loading.value = false
  try {
    const u = (await me())?.user_entity || {}
    userId.value = u.id || ''
    if (u.parent_id) brand.value = (await getDistributor(u.parent_id))?.name || brand.value
  } catch {
    /* 透传仍可尝试 */
  }
  refreshLive()
  timer = setInterval(tick, 5000)
  const cfgId = project.value.using_config_id || project.value.default_config_id
  const [cfg, cats, models, al] = await Promise.allSettled([
    cfgId ? getProjectConfig(cfgId) : Promise.resolve(null),
    getDeviceCategories(),
    getDeviceModels(),
    listAlarms({ level: '1', days: 10 }),
  ])
  config.value = cfg.status === 'fulfilled' ? cfg.value : null
  cfgLoading.value = false
  if (cats.status === 'fulfilled') categories.value = Object.fromEntries(cats.value.map((c) => [c.id, c.name]))
  if (models.status === 'fulfilled') modelCat.value = Object.fromEntries(models.value.map((m) => [m.id, m.category_id]))
  if (al.status === 'fulfilled') alarms.value = al.value.filter((a) => a.projectId === projectId).sort((a, b) => b.ts - a.ts)
  loadSensor()
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('pd-noscroll')
  clearInterval(timer)
  clearInterval(clockTimer)
})
</script>

<style>
html.pd-noscroll,
html.pd-noscroll body {
  overflow: hidden;
}
</style>

<style scoped lang="scss">
/* 版式与 niuniu room-detail 一致（直角细边框面板、标题左上），颜色用 dealer-map 主题变量 */
.pd-screen {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--dm-page-bg, #050d1d);
}
.pd {
  --pd-bg: var(--dm-page-bg, #050d1d);
  --pd-panel: var(--dm-panel-bg, #071630);
  --pd-line: var(--dm-panel-border, rgba(0, 212, 255, 0.28));
  --pd-text: var(--dm-text, #d8ecff);
  --pd-muted: var(--dm-text-muted, #93b5d6);
  --pd-accent: var(--dm-accent, #00d4ff);
  /* 1920×1080 设计稿，按统一比例缩放铺满视口（见 useScreenScale；定位/尺寸/缩放由内联样式给出） */
  display: flex;
  flex-direction: column;
  color: var(--pd-text);
  background: var(--pd-bg);
}
.pd__head {
  position: relative;
  display: flex;
  align-items: center;
  height: 90px;
  padding: 0 20px;
  border-bottom: 1px solid var(--pd-line);
  flex-shrink: 0;
}
.pd__logo {
  display: flex;
  align-items: center;
  .mark {
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #04121f;
    background: var(--pd-accent);
  }
  .name {
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }
}
.pd__title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #fff;
  white-space: nowrap;
}
.pd__right {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
}
.pd__clock {
  font-size: 17px;
  letter-spacing: 1px;
  color: var(--pd-muted);
}
.hbtn {
  padding: 6px 18px;
  font: inherit;
  font-size: 15px;
  color: var(--pd-accent);
  background: rgba(0, 212, 255, 0.12);
  border: 1px solid rgba(0, 212, 255, 0.45);
  border-radius: 2px;
  cursor: pointer;
  &:hover {
    background: rgba(0, 212, 255, 0.22);
  }
  &:focus-visible {
    outline: 2px solid var(--pd-accent);
    outline-offset: 2px;
  }
}
.pd__error {
  margin: 12px 40px 0;
  padding: 8px 12px;
  color: #ff8a7a;
  border: 1px solid rgba(255, 124, 92, 0.6);
}
.pd__body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 20px;
  padding: 20px 40px;
  box-sizing: border-box;
}
.col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.col--left {
  flex: 6;
}
.col--right {
  flex: 4;
}
.box {
  position: relative;
  min-height: 0;
  background: var(--pd-panel);
  border: 1px solid var(--pd-line);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.p-sum {
  flex: 1.5;
}
.p-real {
  flex: 2;
}
.p-stats {
  flex: 2.5;
}
.p-meter,
.p-energy {
  flex: 2;
}
.p-eq {
  flex: 2.5;
}
.ttl {
  font-size: 16px;
  font-weight: bold;
  color: #fff;
}
/* ---------- ProjectSum ---------- */
.sum {
  flex: 1;
  padding: 15px 20px;
  overflow: auto;
  scrollbar-width: none;
}
.sum__top {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 0 10px 20px;
}
.sum__name {
  font-size: 20px;
  font-weight: bold;
  color: #fff;
  white-space: nowrap;
}
.astrip {
  max-width: 320px;
  overflow: hidden;
  padding: 1px 8px;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--pd-muted);
  background: rgba(0, 212, 255, 0.06);
  border: 1px solid rgba(0, 212, 255, 0.25);
  border-radius: 2px;
  cursor: pointer;
  &.on {
    color: #ffd2d2;
    background: rgba(255, 77, 79, 0.1);
    border-color: rgba(255, 77, 79, 0.55);
  }
}
.live {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12px;
  color: var(--pd-muted);
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #8a9bb3;
    &.on {
      background: #00e2a1;
    }
    &.off {
      background: #ff4d4f;
    }
  }
}
.lbtn {
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  color: var(--pd-accent);
  background: none;
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 2px;
  cursor: pointer;
  &:disabled {
    opacity: 0.4;
  }
}
.sum__body {
  display: flex;
  align-items: center;
}
.sum__img {
  flex: 0 0 22%;
  padding: 0 20px;
  img {
    display: block;
    width: 100%;
    max-width: 200px;
  }
}
.sum__cols {
  flex: 1;
  display: flex;
  align-items: flex-start;
}
.sum__col {
  flex: 1;
  min-width: 0;
}
.sum__div {
  align-self: stretch;
  margin: 6px 20px;
  border-left: 1px dashed rgba(147, 181, 214, 0.35);
}
.sum__h {
  margin-bottom: 8px;
  font-size: 16px;
  color: #fff;
}
.kv {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  font-size: 15px;
  white-space: nowrap;
  span {
    width: 78px;
    flex-shrink: 0;
    color: var(--pd-text);
  }
  b {
    font-weight: 400;
    color: #fff;
  }
}
/* ---------- 房间实时情况（niuniu RoomReal 同尺寸结构） ---------- */
.rr {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.rr__title {
  padding: 10px 40px 0;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
}
.rr__content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  padding: 10px 40px;
  overflow: hidden;
}
.rr__nav {
  position: absolute;
  top: 50%;
  z-index: 10;
  width: 32px;
  height: 60px;
  transform: translateY(-50%);
  font-size: 22px;
  color: #fff;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid rgba(0, 212, 255, 0.35);
  cursor: pointer;
  &.l {
    left: 0;
    border-left: 0;
    border-radius: 0 4px 4px 0;
  }
  &.r {
    right: 0;
    border-right: 0;
    border-radius: 4px 0 0 4px;
  }
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}
.rr__wrap {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
.rr__page {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  margin-right: 20px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr)); /* 1080 设计稿下约 120px，1300 高屏幕约 145px */
  gap: 12px;
  scroll-snap-align: start;
  &:last-child {
    margin-right: 0;
  }
}
.rr__card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
  overflow: hidden;
  color: #8193a8;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  transition: all 0.3s ease;
  &.on {
    color: #fff;
    border: 2px solid rgba(0, 212, 255, 0.55);
    background: rgba(0, 212, 255, 0.06);
    box-shadow: 0 0 12px rgba(0, 212, 255, 0.25), inset 0 0 10px rgba(0, 212, 255, 0.1);
  }
}
.rr__head {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}
.rr__card.on .rr__head {
  border-bottom-color: rgba(0, 212, 255, 0.4);
}
.rr__id {
  flex-shrink: 0;
  margin-right: 8px;
  font-size: 12px;
  opacity: 0.6;
}
.rr__name {
  overflow: hidden;
  font-size: 14px;
  font-weight: bold;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rr__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
}
.rr__item {
  display: flex;
  align-items: center;
  width: 100%;
}
.rr__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
}
.rr__card.on .rr__icon {
  border-color: rgba(0, 212, 255, 0.55);
}
.rr__label {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  width: 55px;
  .zh {
    margin-bottom: 2px;
    font-size: 12px;
    opacity: 0.8;
    white-space: nowrap;
  }
  .en {
    font-size: 12px;
    opacity: 0.5;
    transform: scale(0.85);
    transform-origin: left center;
    white-space: nowrap;
  }
}
.rr__val {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  .num {
    font-size: 16px;
    font-weight: bold;
  }
  .unit {
    margin-left: 2px;
    font-size: 11px;
    opacity: 0.6;
  }
}
.rr__empty {
  width: 100%;
  margin-top: 40px;
  text-align: center;
  color: var(--pd-muted);
}
/* ---------- 统计 / 电表 ---------- */
.stats {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 15px 20px;
}
.stats__part {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.stats__div {
  width: 1px;
  margin: 0 20px;
  background: rgba(147, 181, 214, 0.25);
}
.series {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 15px 20px;
}
.part-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
}
.pick :deep(.cp__btn) {
  min-width: 120px;
  height: 24px;
  font-size: 12px;
}
.tabs {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 8px 0 4px;
  button {
    padding: 1px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--pd-muted);
    background: transparent;
    border: 1px solid rgba(147, 181, 214, 0.45);
    border-radius: 2px;
    cursor: pointer;
    &.on {
      color: var(--pd-accent);
      background: rgba(0, 212, 255, 0.1);
      border-color: var(--pd-accent);
    }
  }
}
.chart {
  flex: 1;
  min-height: 0;
  :deep(.echart) {
    width: 100%;
    height: 100%;
  }
}
.empty {
  padding: 16px;
  font-size: 13px;
  color: var(--pd-muted);
  text-align: center;
}
/* ---------- 设备运行系统 ---------- */
.eq-wrap {
  flex: 1;
  min-height: 0;
  margin-top: 10px;
  overflow: auto;
}
.eq {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
  th {
    padding: 6px 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--pd-muted);
    text-align: left;
    background: rgba(0, 212, 255, 0.1);
  }
  td {
    padding: 8px;
    color: var(--pd-text);
    border-bottom: 1px solid rgba(64, 110, 180, 0.15);
  }
  tbody tr:nth-child(even) td {
    background: rgba(0, 212, 255, 0.03);
  }
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5f6f80;
    &.on {
      background: var(--pd-accent);
    }
  }
  .link {
    padding: 0;
    font: inherit;
    color: var(--pd-accent);
    background: none;
    border: 0;
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
  }
}
.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 10px 0 0;
  font-size: 14px;
  color: var(--pd-muted);
  button {
    min-width: 28px;
    height: 28px;
    font: inherit;
    font-size: 14px;
    color: var(--pd-muted);
    background: rgba(0, 212, 255, 0.06);
    border: 1px solid rgba(0, 212, 255, 0.25);
    cursor: pointer;
    &.on {
      color: var(--pd-accent);
      border-color: var(--pd-accent);
    }
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
  }
}
/* ---------- 告警列表 / 抽屉 ---------- */
.astrip__list {
  --pd-muted: var(--dm-text-muted, #93b5d6);
  position: fixed;
  z-index: 80;
  width: min(560px, 90vw);
  max-height: 300px;
  margin: 0;
  padding: 6px 10px;
  overflow: auto;
  list-style: none;
  color: var(--dm-text, #d8ecff);
  background: rgba(6, 18, 40, 0.97);
  border: 1px solid rgba(0, 212, 255, 0.45);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  li {
    display: grid;
    grid-template-columns: 78px 1fr;
    column-gap: 8px;
    padding: 5px 4px;
    font-size: 12px;
    border-bottom: 1px dashed rgba(64, 110, 180, 0.25);
    border-left: 2px solid transparent;
    &.on {
      border-left-color: #ff4d4f;
    }
    &.empty {
      display: block;
      border: 0;
    }
  }
  .t {
    grid-row: span 2;
    color: var(--pd-muted);
  }
  .d {
    color: #fff;
  }
  .c {
    color: var(--pd-muted);
    small {
      margin-left: 6px;
    }
  }
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  width: 400px;
  display: flex;
  flex-direction: column;
  background: var(--pd-panel);
  border-left: 1px solid var(--pd-line);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.5);
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--pd-line);
    b {
      font-size: 16px;
      color: #fff;
    }
  }
  .kv span {
    width: 140px;
    color: var(--pd-muted);
  }
}
.drawer__grid {
  flex: 1;
  overflow: auto;
  padding: 10px 16px;
}
.drawer__group {
  margin: 10px 0 4px;
  padding-left: 8px;
  font-weight: 600;
  color: var(--pd-accent);
  border-left: 3px solid var(--pd-accent);
}
</style>
