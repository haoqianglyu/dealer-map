<template>
  <div class="pd-screen">
  <div class="pd" :style="screenStyle">
    <!-- 顶栏：logo | 项目详情 ······ 时钟 | 主题 返回 退出 -->
    <header class="pd__head">
      <div class="pd__brand">
        <span class="pd__logo" :class="{ pending: brandPending }"><BrandLogo :name="logoName" :height="32" /></span>
        <i class="pd__sep" />
        <h1 class="pd__title">项目详情</h1>
      </div>
      <div class="pd__right">
        <div class="pd__clock"><b>{{ clock.time }}</b><small>{{ clock.date }}</small></div>
        <i class="pd__sep" />
        <div class="seg" role="group" aria-label="主题">
          <button :class="{ on: theme === 'dark' }" :aria-pressed="theme === 'dark'" @click="switchTheme('dark', $event.currentTarget)"><svg class="seg__ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>深色</button>
          <button :class="{ on: theme === 'light' }" :aria-pressed="theme === 'light'" @click="switchTheme('light', $event.currentTarget)"><svg class="seg__ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></g></svg>亮色</button>
        </div>
        <button class="hbtn hbtn--back" @click="back"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7" /></svg>返回上一页</button>
        <button class="hbtn hbtn--out" @click="logout"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>退出登录</button>
      </div>
    </header>
    <div v-if="error" class="pd__error">{{ error }}</div>

    <div class="pd__body">
      <div class="col col--left">
        <!-- 概览：名称 / 告警 / 状态 / 刷新 + 项目信息 + 室内外读数 -->
        <section class="box p-sum">
          <div class="sum__top">
            <div class="sum__name" :class="{ long: title.length > 15 }">{{ title }}</div>
            <button ref="astripBtn" class="astrip" :class="{ on: activeAlarms > 0, err: alarmShow.state === 'error' }" :aria-expanded="alarmOpen" @click="toggleAlarms">
              <span>一级告警</span><i /><span>近 10 天</span><i />
              <span v-if="alarmShow.state === 'loading' || alarmShow.state === 'error'">{{ alarmShow.text }}</span>
              <span v-else>进行中 <b>{{ activeAlarms }}</b> / {{ alarms.length }}<small v-if="alarmShow.state === 'stale'" class="astrip__stale">{{ alarmShow.text }}</small></span>
            </button>
            <span class="live">
              <i :class="['dot', online === true ? 'on' : online === false ? liveFail.dot : '']" />
              <template v-if="liveBusy">查询中…</template>
              <template v-else-if="online === true">实时 <span class="live__t">{{ fmtClock(liveAt) }}</span></template>
              <template v-else-if="online === 'partial'">在线状态 <span class="live__t">{{ fmtClock(liveAt) }}</span></template>
              <template v-else-if="online === false">{{ liveFail.text }}</template>
            </span>
            <button class="rbtn" :disabled="liveBusy" @click="manualRefresh"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" /></svg>刷新</button>
          </div>
          <div class="sum__body">
            <dl class="meta">
              <div><dt>建筑面积</dt><dd><template v-if="project?.building_area"><span class="num">{{ project.building_area }}</span> ㎡</template><template v-else>—</template></dd></div>
              <div><dt>应用</dt><dd>{{ project?.app_name || '—' }}</dd></div>
              <div><dt>版本</dt><dd class="num">{{ project?.app_version || '—' }}</dd></div>
            </dl>
            <i class="vdiv" />
            <div class="rd">
              <BoxLoading :show="(loading || (st[41] === 'loading' && !live[41])) && !hasIndoor" />
              <span />
              <span v-for="c in READINGS" :key="c.key" class="rd__label">{{ c.label }}</span>
              <span class="rd__row">室内</span>
              <span v-for="c in READINGS" :key="c.key" class="rv">
                <template v-if="isNum(indoor[c.key])"><b>{{ fmtNum(indoor[c.key], c.dp) }}</b><small>{{ c.unit }}</small></template>
                <em v-else>—</em>
              </span>
              <i class="rd__hr" />
              <span class="rd__row rd__row--out">室外<small v-if="outdoorNote">来源：{{ outdoorNote }}</small></span>
              <span v-for="c in OUTDOOR_READINGS" :key="c.key" class="rv rv--out">
                <template v-if="isNum(outdoor[c.key])"><b>{{ fmtNum(outdoor[c.key], c.dp) }}</b><small>{{ c.unit }}</small></template>
                <em v-else>—</em>
              </span>
            </div>
          </div>
        </section>

        <!-- 房间曲线：左侧当前时间范围的统计，右侧折线 -->
        <section class="box p-trend">
          <BoxLoading :show="(roomLoading || cfgLoading) && !roomHasData" />
          <div class="trend-h">
            <h2 class="ttl">房间数据曲线</h2>
            <div v-if="rooms.length" class="tabs tabs--metric" :class="{ void: !roomMetrics.length }" role="group" aria-label="指标">
              <button v-for="m in roomMetrics" :key="m.key" :class="{ on: roomMetric === m.key }" @click="roomMetricPick = m.key">{{ m.label }}</button>
            </div>
            <SmallSelect
              v-if="rooms.length"
              :model-value="room?.id"
              :options="rooms.map((s) => ({ value: s.id, label: s.name }))"
              :width="176"
              label="房间"
              prefix="房间"
              @update:model-value="(v) => (roomPick = v)"
            />
            <div class="tabs tabs--range" role="group" aria-label="时间范围">
              <button v-for="r in TREND_RANGES" :key="r.h" :class="{ on: trendHours === r.h }" @click="trendHours = r.h">{{ r.label }}</button>
            </div>
          </div>
          <div class="trend-b">
            <div class="side">
              <div class="side__h">{{ room ? `${roomM.label} · ${room.name}` : '—' }}</div>
              <div class="side__big" :style="roomStats ? { color: metricColor(roomM) } : null">
                <template v-if="roomStats"><b>{{ fmtNum(roomStats.last, roomM.dp) }}</b><small>{{ roomM.unit }}</small></template>
                <em v-else>—</em>
              </div>
              <div class="side__cap">最新读数<template v-if="roomStats"> · {{ fmtTs(roomStats.at) }}</template></div>
              <dl class="side__stats">
                <div v-for="s in STAT_ROWS" :key="s.key"><dt>{{ s.label }}</dt><dd v-if="roomStats">{{ fmtNum(roomStats[s.key], roomM.dp) }}</dd><dd v-else class="dash">—</dd></div>
              </dl>
            </div>
            <div class="chart">
              <EChart v-if="roomHasData" :option="roomOption" />
              <div v-else-if="cfgError" class="chart__msg">配置加载失败<button class="msg-btn" @click="manualRefresh">重试</button></div>
              <div v-else-if="!rooms.length && !cfgLoading" class="chart__msg">该项目未配置房间</div>
              <div v-else-if="roomError && !roomLoading" class="chart__msg">曲线加载失败<button class="msg-btn" @click="manualRefresh">重试</button></div>
              <div v-else-if="!roomLoading && !cfgLoading" class="chart__msg">这段时间暂无数据</div>
            </div>
          </div>
        </section>

        <!-- 室内传感器曲线 -->
        <section class="box p-trend">
          <BoxLoading :show="(sensorLoading || cfgLoading) && !sensorHasData" />
          <div class="trend-h">
            <h2 class="ttl">室内传感器曲线</h2>
            <div v-if="sensors.length" class="tabs tabs--metric" :class="{ void: !sensorMetrics.length }" role="group" aria-label="指标">
              <button v-for="m in sensorMetrics" :key="m.key" :class="{ on: metric === m.key }" @click="metric = m.key">{{ m.label }}</button>
            </div>
            <SmallSelect
              v-if="sensors.length"
              :model-value="sensor?.id"
              :options="sensors.map((s) => ({ value: s.id, label: s.name }))"
              :width="176"
              label="传感器"
              prefix="传感器"
              @update:model-value="(v) => (sensorPick = v)"
            />
            <div class="tabs tabs--range" role="group" aria-label="时间范围">
              <button v-for="r in TREND_RANGES" :key="r.h" :class="{ on: trendHours === r.h }" @click="trendHours = r.h">{{ r.label }}</button>
            </div>
          </div>
          <div class="trend-b">
            <div class="side">
              <div class="side__h">{{ sensor ? `${sensorM.label} · ${sensor.name}` : '—' }}</div>
              <div class="side__big" :style="sensorStats ? { color: metricColor(sensorM) } : null">
                <template v-if="sensorStats"><b>{{ fmtNum(sensorStats.last, sensorM.dp) }}</b><small>{{ sensorM.unit }}</small></template>
                <em v-else>—</em>
              </div>
              <div class="side__cap">最新读数<template v-if="sensorStats"> · {{ fmtTs(sensorStats.at) }}</template></div>
              <dl class="side__stats">
                <div v-for="s in STAT_ROWS" :key="s.key"><dt>{{ s.label }}</dt><dd v-if="sensorStats">{{ fmtNum(sensorStats[s.key], sensorM.dp) }}</dd><dd v-else class="dash">—</dd></div>
              </dl>
            </div>
            <div class="chart">
              <EChart v-if="sensorHasData" :option="sensorOption" />
              <div v-else-if="cfgError" class="chart__msg">配置加载失败<button class="msg-btn" @click="manualRefresh">重试</button></div>
              <div v-else-if="!sensors.length && !cfgLoading" class="chart__msg">该项目未配置室内传感器</div>
              <div v-else-if="sensorError && !sensorLoading" class="chart__msg">曲线加载失败<button class="msg-btn" @click="manualRefresh">重试</button></div>
              <div v-else-if="!sensorLoading && !cfgLoading" class="chart__msg">这段时间暂无数据</div>
            </div>
          </div>
        </section>
      </div>

      <div class="col col--right">
        <!-- 设备运行系统 -->
        <section class="box p-eq">
          <BoxLoading :show="cfgLoading" />
          <div class="eq-h">
            <h2 class="ttl">设备运行系统</h2>
            <div class="eq-sum">
              <template v-if="eqCounts">
                <span><i class="eq-dot on" />在线 <b>{{ eqCounts.on }}</b></span>
                <span><i class="eq-dot off" />离线 <b>{{ eqCounts.off }}</b></span>
              </template>
              <span>共 <b>{{ equipments.length }}</b> 台</span>
              <span v-if="onlineStale" class="eq-stale">在线状态 {{ fmtClock(okAtOnline) }} 未更新</span>
              <span v-if="cfgStale" class="eq-stale">配置未更新</span>
            </div>
          </div>
          <div class="eq-wrap" :class="{ paged: eqPaged }">
            <table class="eq">
              <colgroup><col style="width: 72px" /><col style="width: 200px" /><col style="width: 116px" /><col style="width: 170px" /><col style="width: 184px" /></colgroup>
              <thead>
                <tr><th>状态</th><th>名称</th><th>设备 ID</th><th>类别</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="e in eqShown" :key="e.id" :class="{ off: onlineState(e) === 'off' }">
                  <td class="eq-st" role="img" :aria-label="ONLINE_LABEL[onlineState(e)]">
                    <i v-if="onlineState(e) === 'on' || onlineState(e) === 'off'" class="eq-dot" :class="onlineState(e)" />{{ ONLINE_LABEL[onlineState(e)] }}
                  </td>
                  <td class="eq-name">{{ e.name }}</td>
                  <td class="eq-id">{{ e.id }}</td>
                  <td class="eq-cat">{{ e.category === '-' ? '—' : e.category }}</td>
                  <td class="eq-acts">
                    <button class="act" @click="openDevice(e)">查看数据</button>
                    <button v-if="hasFilter(e)" class="act" @click="openFilter(e)">滤网数据</button>
                  </td>
                </tr>
                <tr v-if="!equipments.length && !cfgLoading"><td colspan="5" class="empty"><template v-if="cfgError">配置加载失败<button class="msg-btn" @click="manualRefresh">重试</button></template><template v-else>暂无数据</template></td></tr>
              </tbody>
            </table>
          </div>
          <div v-if="eqPaged" class="pager">
            <button :disabled="eqPage <= 0" aria-label="上一页" @click="eqPage--">‹</button>
            <button v-for="n in eqPages" :key="n" :class="{ on: eqPage === n - 1 }" @click="eqPage = n - 1">{{ n }}</button>
            <button :disabled="eqPage >= eqPages - 1" aria-label="下一页" @click="eqPage++">›</button>
          </div>
        </section>
      </div>
    </div>

    <!-- 一级告警列表（传送到 body，避免被面板裁切） -->
    <Teleport to="body">
      <ul v-if="alarmOpen" class="astrip__list" :style="alarmPos" @keydown.esc="alarmOpen = false">
        <li v-if="alarmShow.state === 'stale'" class="note">{{ alarmShow.text }}</li>
        <li v-for="a in alarms" :key="a.id" :class="{ on: isActiveAlarm(a) }">
          <span class="t">{{ fmtTs(a.ts) }}</span>
          <span class="d">{{ a.device }}</span>
          <span class="c">{{ a.content }}<small>{{ alarmTag(a) || (isActiveAlarm(a) ? '进行中' : '') }}</small></span>
        </li>
        <li v-if="!alarms.length" class="empty">{{ alarmShow.text }}</li>
      </ul>
    </Teleport>

    <!-- 设备数据抽屉（niuniu Equipments「查看数据」） -->
    <aside v-if="drawer.open" ref="drawerEl" class="drawer" role="dialog" aria-modal="true" tabindex="-1" :aria-label="drawer.title">
      <header>
        <div class="drawer__ttl">
          <small>{{ drawer.kind }}</small>
          <b>{{ drawer.title }}</b>
        </div>
        <button ref="drawerClose" class="hbtn" @click="drawer.open = false">关闭</button>
      </header>
      <div v-if="drawer.loading" class="empty">请求数据中...</div>
      <div v-else-if="drawer.error" class="empty">{{ drawer.error }}</div>
      <div v-else class="drawer__body">
        <div v-if="drawer.hero" class="drawer__hero">
          <span>{{ drawer.hero.label }}</span>
          <b>{{ drawer.hero.num }}<small>{{ drawer.hero.unit }}</small></b>
        </div>
        <template v-for="(it, i) in drawer.items" :key="i">
          <div v-if="noValue(it)" :class="i > 0 && noValue(drawer.items[i - 1]) ? 'drawer__note' : 'drawer__group'">{{ it.title }}</div>
          <div v-else class="drawer__row"><span>{{ it.title }}</span><b>{{ it.value }}</b></div>
        </template>
        <div v-if="!drawer.items.length && !drawer.hero" class="empty">暂无数据</div>
      </div>
    </aside>
  </div>
  </div>
</template>

<script setup>
import { swr, put } from '@/api/detailCache'
// 项目二级界面：布局/板块/内容参照 niuniu room-detail（docs/drilldown-ref.md），配色用 dealer-map 主题。
// 实时数据走设备透传「查询」消息（41/40/44/43/30/15），只在打开本页时查询；页面可见时最多每 60 秒自动刷新一次。
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { theme, switchTheme } from '@/composables/useTheme'
import { defaultBrand } from '@/config/brand'
import { useRoute, useRouter } from 'vue-router'
import SmallSelect from '@/components/SmallSelect.vue'
import BoxLoading from '@/components/BoxLoading.vue'
import { useStretchScale } from '@/composables/useScreenScale'
import BrandLogo from '@/components/BrandLogo.vue'
import { toLogin } from '@/api/http'
import EChart from '@/components/EChart.vue'
import { graphic } from 'echarts/core'
import { me, getDistributor, getProject, getProjectConfig, getDeviceDataList, getRoomDataList, getWeather, getDeviceCategories, getDeviceModels, sharedAlarms } from '@/api'
import { ctrlQuery, DeviceTimeout } from '@/api/ctrl'
import { isActiveAlarm, alarmTag } from '@/geo/states'
import { parseRegion } from '@/utils/region'
import { tooltipStyle, categoryAxis, valueAxis, isLight } from '@/utils/chartTheme'
import { isShowroom, showName } from '@/utils/showroom'
import { createAlarmTracker, retryDelay } from '@/geo/alarmPoll'
import { alarmDisplay, onlineStateOf, ONLINE_LABEL, liveFailText } from '@/utils/detailStatus'

defineOptions({ name: 'ProjectDetail' })
const { style: screenStyle, sy } = useStretchScale()
const clock = reactive({ time: '', date: '' })
const WEEK = '日一二三四五六'
function tickClock() {
  const d = new Date()
  clock.time = d.toTimeString().slice(0, 8)
  clock.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 星期${WEEK[d.getDay()]}`
}
tickClock()
const clockTimer = setInterval(tickClock, 1000)
const brand = ref('') // 经销商名称
const brandPending = ref(true) // 资料返回前用登录品牌的 logo 半透明占位（同地图页）
const logoName = computed(() => brand.value || defaultBrand()?.name || '')
function logout() {
  toLogin('已退出登录', 'info') // 整页重载，销毁 keep-alive 里的地图实例，换账号不留旧数据
}
const SENSOR_MODEL = '620db09cdcae9b926dc804e1' // niuniu：室内传感器 model
// 曲线配色：每个指标固定一种颜色（侧栏大数与线同色）；面积为同色极淡竖向渐变
const NIU = { blue: [24, 144, 255], green: [0, 201, 120], cyan: [0, 229, 255], yellow: [245, 194, 43], purple: [179, 127, 235] }
// 亮色（§2.4）：同色相加深
const NIU_LIGHT = { blue: [29, 111, 214], green: [12, 124, 85], cyan: [14, 116, 144], yellow: [161, 98, 7], purple: [109, 79, 211] }
const NIU_NAME = new Map(Object.entries(NIU).map(([k, v]) => [v, k]))
const seriesRgb = (rgb) => (isLight() ? NIU_LIGHT[NIU_NAME.get(rgb)] || rgb : rgb)
const metricColor = (m) => `rgb(${seriesRgb(m.color).join(', ')})`
function lineStyleOf(rgb) {
  const [r, g, b] = seriesRgb(rgb)
  const a0 = isLight() ? 0.1 : 0.16
  const c = `rgb(${r}, ${g}, ${b})`
  return {
    itemStyle: { color: c },
    lineStyle: { width: 2.5, color: c },
    areaStyle: { color: new graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `rgba(${r}, ${g}, ${b}, ${a0})` }, { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0)` }]) },
  }
}
const METRICS = [
  { key: 'd1', label: '温度', unit: '°C', dp: 1, color: NIU.blue },
  { key: 'd2', label: '湿度', unit: '%', dp: 0, color: NIU.green },
  { key: 'dew', label: '露点', unit: '°C', dp: 1, color: NIU.yellow },
  { key: 'd3', label: 'PM2.5', unit: 'μg/m³', dp: 0, color: NIU.cyan },
  { key: 'd4', label: 'CO₂', unit: 'ppm', dp: 0, color: NIU.purple },
]
const LIVE_INTERVAL = 30 * 60000 // 现场查询、曲线、设备列表、告警统一 30 分钟；手动「刷新」立即更新
const TREND_INTERVAL = 30 * 60000 // 曲线每小时才一个点，30 分钟重取一次足够
let trendAt = 0
const STALE_AFTER = 2 * LIVE_INTERVAL - 60000 // 连续两轮没拿到新值，旧的现场数据作废
const MIN = 60000
let alive = true // 页面卸载后，初始化流程里还没跑完的步骤不再继续
const ac = new AbortController() // 卸载时取消进行中的现场查询

const route = useRoute()
const router = useRouter()
const showroom = isShowroom()
const projectId = String(route.params.id || '')
const project = ref(null)
const config = ref(null)
const cfgOf = (p) => p?.using_config_id || p?.default_config_id
// 只接受当前项目正在使用的配置：旧配置的响应晚到时丢弃
const setConfig = (id, c) => {
  if (alive && c && id === cfgOf(project.value)) config.value = c
}
const loading = ref(true)
const error = ref('')
const alarms = ref([])
// 告警分开加载中 / 失败 / 真的没有，沿用地图的过期策略（geo/alarmPoll）
const alarmTracker = createAlarmTracker()
const alarmView = ref(alarmTracker.current())
const alarmsLoaded = ref(false)
const alarmShow = computed(() => alarmDisplay(alarmsLoaded.value, alarmView.value))
let alarmRetry = 0
const categories = ref({})
const modelCat = ref({})
const userId = ref('')

const title = computed(() => (project.value ? showName(project.value.name) : '项目详情'))
const z = (n) => String(n).padStart(2, '0')
const fmtTs = (ms) => {
  const d = new Date(ms)
  return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
}
const fmtClock = (ms) => {
  const d = new Date(ms)
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}
// 读数：数字和单位分开渲染；温度 / 露点 1 位小数，其余取整，缺值由模板显示「—」
const isNum = (v) => validNum(v)
const fmtNum = (v, dp) => (+v).toFixed(dp)
const READINGS = [
  { key: 'temperature', label: '温度', unit: '°C', dp: 1 },
  { key: 'humidity', label: '湿度', unit: '%', dp: 0 },
  { key: 'pm25', label: 'PM2.5', unit: 'μg/m³', dp: 0 },
  { key: 'co2', label: 'CO₂', unit: 'ppm', dp: 0 },
]
const OUTDOOR_READINGS = READINGS.slice(0, 3) // 室外没有 CO₂
const STAT_ROWS = [
  { key: 'max', label: '最高' },
  { key: 'min', label: '最低' },
  { key: 'avg', label: '均值' },
]

// ---------- 实时透传查询 ----------
// st[type]: 'idle' | 'loading' | 'ok' | 'timeout' | 'error'
const st = reactive({ 41: 'idle', 30: 'idle' })
const live = reactive({ 41: null, 30: null })
const okAt = { 41: 0, 30: 0 } // 各数据源最后一次成功的时间
const liveAt = ref(0)
const liveBusy = ref(false)
const liveFail = computed(() => liveFailText(st[41], st[30]))
const online = ref(null)
async function runQuery(type, opts = {}) {
  st[type] = 'loading'
  try {
    const r = await ctrlQuery(type, { projectId, userId: userId.value, signal: ac.signal, ...opts })
    st[type] = 'ok'
    return r
  } catch (e) {
    st[type] = e instanceof DeviceTimeout ? 'timeout' : 'error'
    return null
  }
}
async function refreshLive(manual = true) {
  if (!alive || liveBusy.value || !project.value) return
  liveBusy.value = true
  const [r41, r30] = await Promise.all([
    runQuery(41),
    // 在线列表回来就先显示，不等其它查询
    runQuery(30, { query: { projectId } }).then((r) => {
      if (r) {
        prevOnline.value = manual ? [] : live[30]?.ids || [] // 手动刷新绕过防抖，显示这次的真实结果
        live[30] = r
        okAt[30] = Date.now()
        okAtOnline.value = okAt[30]
      }
      return r
    }),
  ])
  if (!alive) return
  const now = Date.now()
  if (r41) {
    live[41] = r41
    okAt[41] = now
  }
  for (const [t, r] of [[41, r41], [30, r30]]) {
    if (!r && okAt[t] && now - okAt[t] >= STALE_AFTER) {
      live[t] = null
      okAt[t] = 0
      if (t === 30) prevOnline.value = []
    }
  }
  // true = 现场数据已更新；partial = 只有在线状态更新了
  online.value = r41 ? true : r30 ? 'partial' : false
  liveAt.value = now
  liveBusy.value = false
}
const ALARM_SORT = (a, b) => b.ts - a.ts
let timer = null
function tick() {
  applyAlarmView(alarmTracker.current()) // 失败久了按时过期（30 分钟后不再沿用旧告警）
  if (document.visibilityState === 'visible' && Date.now() - liveAt.value >= LIVE_INTERVAL - 1000) refreshLive(false)
  if (document.visibilityState === 'visible' && trendAt && Date.now() - trendAt >= TREND_INTERVAL) reloadTrends()
}

// 传感器超过 24 小时没上报就不再当作当前室内数据
const recentSensor = computed(() => (latest.value && Date.now() / 1000 - Number(latest.value.timestamp) < 86400 ? latest.value : null))
const indoor = computed(() => live[41]?.indoorData || (recentSensor.value ? { temperature: recentSensor.value.d1, humidity: recentSensor.value.d2, pm25: recentSensor.value.d3, co2: recentSensor.value.d4 } : {}))
// 室外：现场 41 有室外数据就用现场；否则用项目所在城市的天气（同小程序首页 /wx/weather）
const weather = ref(null)
const siteOutdoor = computed(() => {
  const o = live[41]?.outdoorData
  return o && validNum(o.temperature) ? o : null
})
const numOf = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}
const outdoor = computed(() => {
  if (siteOutdoor.value) return siteOutdoor.value
  const now = weather.value?.now
  return now ? { temperature: numOf(now.temperature), humidity: numOf(now.sd), pm25: numOf(now.aqiDetail?.pm2_5) } : {}
})
const hasIndoor = computed(() => READINGS.some((c) => validNum(indoor.value[c.key])))
const outdoorNote = computed(() => (siteOutdoor.value || !weather.value?.now ? '' : `${weather.value.cityInfo?.c3 || ''}天气`))
const MUNICIPALITIES = ['110000', '120000', '310000', '500000']
let weatherSeq = 0
async function loadWeather() {
  const r = parseRegion(project.value?.customer_region || '')
  const city = MUNICIPALITIES.includes(r.province) ? r.province : r.city
  if (!city) return
  const seq = ++weatherSeq
  try {
    const w = await getWeather(city)
    if (seq === weatherSeq && w?.now) weather.value = w
  } catch {
    // 失败时保留上一次的天气
  }
}
const alarmOpen = ref(false)
const astripBtn = ref(null)
const alarmPos = ref({})
function toggleAlarms() {
  const r = astripBtn.value?.getBoundingClientRect()
  if (r) alarmPos.value = { top: `${r.bottom + 4}px`, left: `${r.left}px` }
  alarmOpen.value = !alarmOpen.value
}
// 防抖：平台的在线列表每次可能少几台，连续两次成功查询都不在列表里才算离线
const prevOnline = ref([])
const onlineIds = computed(() => new Set([...(live[30]?.ids || []), ...prevOnline.value].map(String)))
// 查询中不显示圆点；查询失败（网络 / 超时）显示未知，不判离线
const onlineState = (e) => onlineStateOf(st[30], Boolean(live[30]), onlineIds.value.has(String(e.id)))
// 在线列表这次没更新、在用上次的结果
const okAtOnline = ref(0)
const onlineStale = computed(() => Boolean(live[30]) && (st[30] === 'timeout' || st[30] === 'error'))

// 设备数据抽屉（15 DeviceDataGetQuery）
const drawer = reactive({ open: false, kind: '', title: '', hero: null, loading: false, error: '', items: [] })
let drawerSeq = 0 // 连点两台设备时，只显示最后一次的结果
// 平台「查看数据 / 滤网数据」两个抽屉：同一套回执结构（equipmentName + data[{title, value}]），只读
async function openDeviceData(type, e) {
  const seq = ++drawerSeq
  Object.assign(drawer, { open: true, kind: type === 6 ? '滤网数据' : '设备数据', title: e.name, hero: null, loading: true, error: '', items: [] })
  try {
    const r = await ctrlQuery(type, { projectId, userId: userId.value, query: { deviceId: String(e.id) }, signal: ac.signal })
    if (seq !== drawerSeq) return
    drawer.title = r.equipmentName || e.name
    const items = (r.data || []).filter((it) => String(it?.title ?? '').trim() || !noValue(it)) // 平台偶尔回空条目
    if (type === 6) {
      // 滤网：剩余寿命是这张卡的重点，单独放大；设备名称已在抽屉标题里
      const life = items.find((it) => /剩余寿命/.test(it.title || '') && /^-?\d+\s*\D*$/.test(String(it.value ?? '').trim()))
      if (life) {
        const [, num, unit] = String(life.value).trim().match(/^(-?\d+)\s*(\D*)$/)
        drawer.hero = { label: life.title, num, unit }
      }
      drawer.items = items.filter((it) => it !== life && it.title !== '设备名称')
    } else {
      drawer.items = items
    }
  } catch (err) {
    if (seq !== drawerSeq) return
    drawer.error = err instanceof DeviceTimeout ? '现场设备未响应' : '查询失败'
  } finally {
    if (seq === drawerSeq) drawer.loading = false
  }
}
// 没有值的条目：第一条是分组标题，紧跟着的是该组下的条目（如「故障」下的各项）
const noValue = (it) => it?.value === undefined || it?.value === null || it?.value === ''
// 键盘 / 遥控：抽屉打开时焦点移进来，关闭还给原按钮；Esc 关闭（焦点在哪都行）；Tab 留在抽屉内
const drawerEl = ref(null)
const drawerClose = ref(null)
let drawerPrev = null
watch(() => drawer.open, (open) => {
  if (open) {
    drawerPrev = document.activeElement
    nextTick(() => (drawerClose.value || drawerEl.value)?.focus())
  } else {
    const el = drawerPrev
    drawerPrev = null
    if (el && document.contains(el)) el.focus()
  }
})
function onDocKey(e) {
  if (e.key === 'Escape') {
    if (drawer.open) {
      drawer.open = false
      e.stopPropagation()
    } else if (alarmOpen.value) alarmOpen.value = false
    return
  }
  if (e.key !== 'Tab' || !drawer.open || !drawerEl.value) return
  const list = [...drawerEl.value.querySelectorAll('button,[tabindex="0"],a[href]')].filter((n) => !n.disabled)
  if (!list.length) return
  const first = list[0]
  const last = list[list.length - 1]
  if (e.shiftKey && (document.activeElement === first || document.activeElement === drawerEl.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (document.activeElement === last || !drawerEl.value.contains(document.activeElement))) {
    e.preventDefault()
    first.focus()
  }
}
const openDevice = (e) => openDeviceData(15, e)
const openFilter = (e) => openDeviceData(6, e)
// 平台只在空气处理机（新风机）上提供滤网数据
const hasFilter = (e) => String(e.category || '').includes('空气处理机')

// ---------- 静态配置：设备清单 / 传感器历史 ----------
const equipments = computed(() => {
  const c = config.value
  if (!c) return []
  const list = []
  const cat = (item) => {
    const model = Array.isArray(item.model) && item.model.length ? item.model[item.model.length - 1] : null
    return categories.value[modelCat.value[model]] || '-'
  }
  const add = (it) => it?.id && it?.name && list.push({ id: it.id, name: it.name, category: cat(it) })
  const isFloors = (k) => /floorConfigModel/i.test(k) // floorConfigModel / undergroundFloorConfigModel：楼层本身不是设备
  for (const [k, v] of Object.entries(c)) if (Array.isArray(v) && !isFloors(k)) v.forEach(add)
  // 房间温控面板在各楼层的 roomConfigList 里（和平台「查看设备」的顺序一致：先系统设备，后房间）
  for (const [k, v] of Object.entries(c)) if (Array.isArray(v) && isFloors(k)) v.forEach((f) => (f?.roomConfigList || []).forEach(add))
  return list
})
const eqPage = ref(0)
const EQ_PAGE = 16 // 右列整列都给设备表（原两个待定框已合并）
const eqPages = computed(() => Math.max(1, Math.ceil(equipments.value.length / EQ_PAGE)))
const eqPaged = computed(() => equipments.value.length > EQ_PAGE) // 超过 16 台才分页（行高 49 + 分页行 48）
// 在线 / 离线台数：沿用 onlineState；在线列表还没成功返回过时不显示
const eqCounts = computed(() => {
  if (!live[30] || !equipments.value.length) return null // 在线列表拿不到：不显示在线 / 离线计数
  const c = { on: 0, off: 0 }
  for (const e of equipments.value) c[onlineState(e)]++
  return c
})
const eqShown = computed(() => equipments.value.slice(eqPage.value * EQ_PAGE, eqPage.value * EQ_PAGE + EQ_PAGE))
watch(eqPages, (n) => {
  if (eqPage.value > n - 1) eqPage.value = n - 1
})

const sensors = computed(() => (config.value?.['传感器Model'] || []).filter((s) => JSON.stringify(s.model || '').includes(SENSOR_MODEL)))
const sensorPick = ref(null)
const sensor = computed(() => sensors.value.find((s) => String(s.id) === String(sensorPick.value)) || sensors.value[0] || null) // 按 id 记选中项，配置变化不错位
const metric = ref('d1')
const sensorRows = ref([])
const sensorLoading = ref(false)
const cfgLoading = ref(true) // 项目配置 / 设备类别加载中（设备表、传感器列表依赖它）
const cfgError = ref(false) // 配置查询失败（不是「未配置」）；有旧配置时只标 cfgStale
const cfgStale = ref(false)
const latest = computed(() => sensorRows.value.reduce((a, b) => (!a || Number(b.timestamp) > Number(a.timestamp) ? b : a), null))
// 历史曲线：一次取最近 30 天（平台每小时一个点），切换时间范围只在前端裁剪，不再请求
const TREND_RANGES = [
  { h: 24, label: '24小时' },
  { h: 24 * 5, label: '5天' },
  { h: 24 * 10, label: '10天' },
  { h: 24 * 30, label: '30天' },
]
const TREND_FETCH_SEC = 30 * 86400
const trendHours = ref(24 * 10)
const NO_SENSOR = -100 // 平台用 -100 表示该房间没有这个传感器
const validNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v) && +v > NO_SENSOR
// [[毫秒时间戳, 值], ...]；缺数超过 3 小时插入 null，曲线断开而不是直线连过去
function trendPoints(rows, key) {
  const cut = Date.now() / 1000 - trendHours.value * 3600
  const out = []
  let prev = 0
  for (const it of [...rows].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
    const t = Number(it.timestamp)
    if (t < cut || !validNum(it[key])) continue
    if (prev && t - prev > 3 * 3600) out.push([(prev + 3600) * 1000, null])
    out.push([t * 1000, +(+it[key]).toFixed(1)])
    prev = t
  }
  return out
}
// 露点：与数据管理系统（test.cosyhome.com.cn）calculateDewPoint 同一公式（Magnus，0℃ 上下两组系数）
function dewPoint(tRaw, hRaw) {
  if (!validNum(tRaw) || !validNum(hRaw) || +hRaw <= 0) return null
  const t = +tRaw
  const [a, b] = t > 0 ? [7.5, 237.3] : [9.5, 265.5]
  const es = 6.11 * Math.pow(10, (a * t) / (b + t))
  const dew = b / (a / Math.log10(((+hRaw / 100) * es) / 6.11) - 1)
  return Number.isFinite(dew) ? +dew.toFixed(1) : null
}
const withDew = (rows, tKey, hKey) => rows.map((r) => ({ ...r, dew: dewPoint(r[tKey], r[hKey]) }))
const hasValid = (rows, key) => rows.some((it) => validNum(it[key]))
// 横轴用数值轴 + 固定间隔：刻度落在整点/零点且等距（ECharts time 轴跨月时刻度不均匀）
const TREND_TICK_H = { 24: 4, 120: 24, 240: 24, 720: 72 }
// 前后都断开的孤立点画成圆点，否则折线画不出来
function markIsolated(points) {
  return points.map((p, i) => (p[1] !== null && !(points[i - 1]?.[1] != null) && !(points[i + 1]?.[1] != null) ? { value: p, symbol: 'circle', symbolSize: 7 } : p))
}
// 侧栏：当前时间范围内已取回的点（points 已按 trendHours 裁剪）；没有有效点返回 null
function trendStats(points) {
  const pts = points.filter((p) => p[1] !== null)
  if (!pts.length) return null
  const vals = pts.map((p) => p[1])
  const last = pts[pts.length - 1]
  return { last: last[1], at: last[0], max: Math.max(...vals), min: Math.min(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length }
}
// 终点：10px 实心圆 + 胶囊标签（标签由 series.endLabel 画），虚线落到 x 轴
function markEnd(data) {
  const i = data.length - 1
  if (i < 0) return data
  const out = [...data]
  const v = Array.isArray(out[i]) ? out[i] : out[i].value
  out[i] = { value: v, symbol: 'circle', symbolSize: 10 }
  return out
}
function trendOption(points, m) {
  const short = trendHours.value <= 24
  const stepMs = TREND_TICK_H[trendHours.value] * 3600 * 1000
  const now = Date.now()
  const start = new Date(now - trendHours.value * 3600 * 1000)
  start.setMinutes(0, 0, 0)
  if (short) start.setHours(start.getHours() - (start.getHours() % 4))
  else start.setHours(0)
  const axis = categoryAxis({})
  delete axis.data
  const light = isLight()
  const axisFont = { color: light ? '#5b6b80' : '#8fb0d0', fontFamily: 'DM Num, DIN Alternate, Bahnschrift, sans-serif', fontSize: Math.max(14, 10 / sy.value) }
  const seriesC = metricColor(m)
  const vals = points.filter((p) => p[1] !== null)
  const last = vals[vals.length - 1]
  const yMin = vals.length ? Math.floor(Math.min(...vals.map((p) => p[1]))) : 0
  return {
    grid: { left: 48, right: 90, top: 14, bottom: 40 },
    tooltip: {
      ...tooltipStyle(),
      textStyle: { ...tooltipStyle().textStyle, fontSize: Math.max(14, 10 / sy.value) },
      trigger: 'axis',
      formatter: (ps) => {
        const p = ps[0]
        const d = new Date(p.value[0])
        const v = p.value[1]
        return `${d.getMonth() + 1}-${z(d.getDate())} ${z(d.getHours())}:00<br/>${p.marker}${p.seriesName}　<b>${v === null || v === undefined ? '--' : `${v}${m.unit}`}</b>`
      },
    },
    xAxis: {
      ...axis,
      type: 'value',
      min: start.getTime(),
      max: now,
      interval: stepMs,
      axisLine: { show: false },
      splitLine: { show: false },
      axisLabel: {
        ...(axis.axisLabel || {}),
        ...axisFont,
        showMaxLabel: false,
        hideOverlap: true,
        formatter: (ms) => {
          const d = new Date(ms)
          return short ? `${z(d.getHours())}:00` : `${d.getMonth() + 1}-${z(d.getDate())}`
        },
      },
    },
    // 上下界取整，避免出现 24 / 24.1 挤在一起的刻度
    yAxis: valueAxis({
      axisTick: { show: false },
      axisLabel: axisFont,
      splitLine: { lineStyle: { color: light ? 'rgba(16, 33, 58, 0.08)' : 'rgba(120, 170, 255, 0.1)', type: 'dashed' } },
      min: (v) => Math.floor(v.min),
      max: (v) => (Math.ceil(v.max) > Math.floor(v.min) ? Math.ceil(v.max) : Math.floor(v.min) + 1),
    }),
    series: [
      {
        type: 'line',
        name: m.label,
        data: markEnd(markIsolated(points)),
        symbol: 'none',
        smooth: false,
        connectNulls: false,
        ...lineStyleOf(m.color),
        endLabel: {
          show: true,
          distance: 12,
          formatter: (p) => fmtNum(p.value[1], m.dp),
          color: light ? '#fff' : '#04121c',
          backgroundColor: seriesC,
          fontFamily: axisFont.fontFamily,
          fontSize: Math.max(14, 10 / sy.value),
          fontWeight: 600,
          padding: [6, 8],
          borderRadius: 4,
        },
        markLine: last
          ? {
              silent: true,
              animation: false,
              symbol: 'none',
              label: { show: false },
              lineStyle: { type: 'dotted', width: 1, color: seriesC, opacity: 0.6 },
              data: [[{ coord: [last[0], last[1]] }, { coord: [last[0], yMin] }]],
            }
          : undefined,
      },
    ],
  }
}

const sensorMetrics = computed(() => METRICS.filter((m) => hasValid(sensorRows.value, m.key)))
watch(sensorMetrics, (ms) => {
  if (ms.length && !ms.some((m) => m.key === metric.value)) metric.value = ms[0].key
})
const sensorM = computed(() => METRICS.find((x) => x.key === metric.value) || METRICS[0])
const sensorPoints = computed(() => trendPoints(sensorRows.value, metric.value))
const sensorStats = computed(() => trendStats(sensorPoints.value))
const sensorHasData = computed(() => sensorPoints.value.some((p) => p[1] !== null))
const sensorOption = computed(() => trendOption(sensorPoints.value, METRICS.find((x) => x.key === metric.value)))
let sensorSeq = 0
async function loadSensor(keep = false) {
  const s = sensor.value
  const seq = ++sensorSeq
  if (!s || !project.value) {
    sensorRows.value = []
    sensorLoading.value = false
    return
  }
  sensorLoading.value = true
  const end = Math.floor(Date.now() / 1000)
  try {
    const rows = await getDeviceDataList({ deviceId: s.id, projectId, start: end - TREND_FETCH_SEC, end })
    if (seq === sensorSeq) {
      sensorRows.value = withDew(rows, 'd1', 'd2')
      sensorError.value = false
    }
  } catch {
    if (seq === sensorSeq) {
      if (!keep) sensorRows.value = []
      sensorError.value = !sensorRows.value.length
    }
  } finally {
    if (seq === sensorSeq) sensorLoading.value = false
  }
}
// 切换对象时先清空，避免新名称下显示旧对象的曲线；默认选中项也写入 id，配置顺序变了不跳
watch(() => sensor.value?.id, (id) => {
  if (id != null) sensorPick.value = id
  sensorRows.value = []
  loadSensor()
})

// 房间曲线：房间来自项目配置各楼层的 roomConfigList
const ROOM_METRICS = [
  { key: 'temperature', label: '温度', unit: '°C', dp: 1, color: NIU.blue },
  { key: 'humidity', label: '湿度', unit: '%', dp: 0, color: NIU.green },
  { key: 'dew', label: '露点', unit: '°C', dp: 1, color: NIU.yellow },
  { key: 'pm25', label: 'PM2.5', unit: 'μg/m³', dp: 0, color: NIU.cyan },
  { key: 'co2', label: 'CO₂', unit: 'ppm', dp: 0, color: NIU.purple },
]
const rooms = computed(() => {
  const c = config.value || {}
  return Object.entries(c)
    .filter(([k, v]) => /floorConfigModel/i.test(k) && Array.isArray(v))
    .flatMap(([, v]) => v.flatMap((f) => f?.roomConfigList || []))
    .filter((r) => r?.id && r?.name)
})
const roomPick = ref(null)
const room = computed(() => rooms.value.find((r) => String(r.id) === String(roomPick.value)) || rooms.value[0] || null)
const roomRows = ref([])
const roomLoading = ref(false)
const roomError = ref(false)
const sensorError = ref(false)
const roomMetricPick = ref('temperature')
const roomMetrics = computed(() => ROOM_METRICS.filter((m) => hasValid(roomRows.value, m.key)))
// 切到没有该传感器的房间时，退回温度（第一个有数据的指标）
const roomMetric = computed(() => (roomMetrics.value.some((m) => m.key === roomMetricPick.value) ? roomMetricPick.value : roomMetrics.value[0]?.key || 'temperature'))
const roomM = computed(() => ROOM_METRICS.find((x) => x.key === roomMetric.value) || ROOM_METRICS[0])
const roomPoints = computed(() => trendPoints(roomRows.value, roomMetric.value))
const roomStats = computed(() => trendStats(roomPoints.value))
const roomHasData = computed(() => roomPoints.value.some((p) => p[1] !== null))
const roomOption = computed(() => trendOption(roomPoints.value, ROOM_METRICS.find((x) => x.key === roomMetric.value)))
let roomSeq = 0
async function loadRoom(keep = false) {
  const r = room.value
  const seq = ++roomSeq
  if (!r || !project.value) {
    roomRows.value = []
    roomLoading.value = false
    return
  }
  roomLoading.value = true
  const end = Math.floor(Date.now() / 1000)
  try {
    const rows = await getRoomDataList({ roomId: String(r.id), projectId, start: end - TREND_FETCH_SEC, end })
    if (seq === roomSeq) {
      roomRows.value = withDew(rows, 'temperature', 'humidity')
      roomError.value = false
    }
  } catch {
    if (seq === roomSeq) {
      if (!keep) roomRows.value = []
      roomError.value = !roomRows.value.length
    }
  } finally {
    if (seq === roomSeq) roomLoading.value = false
  }
}
watch(() => room.value?.id, (id) => {
  if (id != null) roomPick.value = id
  roomRows.value = []
  loadRoom()
})
// 定时 / 手动重取曲线：失败时保留现有曲线，不闪空
function loadAlarms() {
  clearTimeout(alarmRetry)
  alarmRetry = 0
  return sharedAlarms.get({ maxAge: 30000 }).then(
    (list) => {
      if (!alive) return
      alarmsLoaded.value = true
      applyAlarmView(alarmTracker.ok(list.filter((a) => a.projectId === projectId).sort(ALARM_SORT)))
    },
    (e) => {
      if (!alive) return
      alarmsLoaded.value = true
      const v = alarmTracker.fail(e?.response?.status)
      applyAlarmView(v)
      if (v.error !== 'forbidden') alarmRetry = setTimeout(loadAlarms, retryDelay(v.fails))
    }
  )
}
function applyAlarmView(v) {
  alarmView.value = v
  alarms.value = v.alarms
}
let reloadSeq = 0
function reloadTrends() {
  if (!alive) return
  trendAt = Date.now()
  const seq = ++reloadSeq
  const current = () => alive && seq === reloadSeq // 连续刷新时，旧响应不覆盖新值
  loadSensor(true)
  loadRoom(true)
  if (!siteOutdoor.value) loadWeather() // 现场有室外数据时不用查天气
  loadAlarms()
  // 项目信息和设备列表：拿到新值才替换，失败时保持现状。选中项按 id 记，配置变了 watch 会重取对应曲线
  getProject(projectId).then((p) => {
    if (!p || !current()) return
    put(`project:${projectId}`, p)
    project.value = p
    const cfgId = p.using_config_id || p.default_config_id
    if (cfgId) getProjectConfig(cfgId).then((c) => {
      if (!c || !current()) return
      put(`config:${cfgId}`, c)
      setConfig(cfgId, c)
      cfgError.value = false
      cfgStale.value = false
    }).catch(() => {
      if (!current()) return
      if (config.value) cfgStale.value = true
      else cfgError.value = true
    })
  }).catch(() => {})
}
function manualRefresh() {
  if (error.value) return location.reload() // 首次加载失败时流程没走完，整页重来
  refreshLive()
  reloadTrends()
}

const activeAlarms = computed(() => alarms.value.filter(isActiveAlarm).length)

function back() {
  // 地图页用 keep-alive 保留，返回即恢复原视图
  if (window.history.state?.back) router.back()
  else router.push('/dealer-map')
}

onMounted(async () => {
  window.addEventListener('keydown', onDocKey)
  document.documentElement.classList.add('pd-noscroll') // 本页 html/body 不出滚动条
  const mePromise = swr('me', me, { maxAge: 60 * MIN }).then((r) => r?.user_entity || {}).catch(() => ({})) // 不依赖项目，同时发
  try {
    project.value = await swr(`project:${projectId}`, () => getProject(projectId), {
      maxAge: 10 * MIN,
      onFresh: (p) => {
        if (!alive) return
        const changed = (p.using_config_id || p.default_config_id) !== (project.value?.using_config_id || project.value?.default_config_id)
        project.value = p
        if (changed) reloadTrends() // 配置换了，设备和曲线跟着重取
      },
    })
    if (!alive) return
    if (!project.value) throw new Error('未找到该项目或无权限')
  } catch (e) {
    if (!alive) return
    error.value = e?.message || '项目加载失败'
    brandPending.value = false
    loading.value = false
    cfgLoading.value = false
    return
  }
  loading.value = false
  loadWeather()
  const u = await mePromise
  if (!alive) return
  userId.value = u.id || ''
  if (u.parent_id) {
    // 只影响品牌名，不挡后面的请求
    swr(`distributor:${u.parent_id}`, () => getDistributor(u.parent_id), { maxAge: 60 * MIN })
      .then((d) => { if (alive && d?.name) brand.value = d.name })
      .catch(() => {})
      .finally(() => { if (alive) brandPending.value = false })
  } else {
    brandPending.value = false
  }
  refreshLive()
  timer = setInterval(tick, 5000)
  loadAlarms()
  const cfgId = project.value.using_config_id || project.value.default_config_id
  const catsP = swr('device-categories', getDeviceCategories, { maxAge: 60 * MIN })
  const modelsP = swr('device-models', getDeviceModels, { maxAge: 60 * MIN })
  const cfg = cfgId
    ? await swr(`config:${cfgId}`, () => getProjectConfig(cfgId), {
        maxAge: 10 * MIN,
        onFresh: (c) => setConfig(cfgId, c),
      }).catch(() => {
        cfgError.value = !config.value
        return null
      })
    : null
  if (!alive) return
  setConfig(cfgId, cfg) // 房间 / 传感器列表就绪后，watch 按选中项 id 取曲线
  trendAt = Date.now()
  const [cats, models] = await Promise.allSettled([catsP, modelsP])
  if (!alive) return
  cfgLoading.value = false
  if (cats.status === 'fulfilled') categories.value = Object.fromEntries(cats.value.map((c) => [c.id, c.name]))
  if (models.status === 'fulfilled') modelCat.value = Object.fromEntries(models.value.map((m) => [m.id, m.category_id]))
})
onBeforeUnmount(() => {
  alive = false
  ac.abort()
  window.removeEventListener('keydown', onDocKey)
  clearTimeout(alarmRetry)
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
/* 字号：电视上最小 14（设计稿像素）；拉伸缩放后渲染字号至少 10px（--pd-min-fs） */
@mixin fs($n) {
  font-size: max(#{$n}px, var(--pd-min-fs, 0px));
}

.pd-screen {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--dm-bg);
}
.pd {
  /* 1920×1080 设计稿，按 x / y 各自缩放铺满视口（useStretchScale；定位/尺寸/缩放由内联样式给出） */
  --pd-panel: var(--dm-panel-bg, var(--dm-panel));
  --pd-solid: var(--dm-panel-bg, #0a1626); /* 抽屉要盖住下面的表格：实底 */
  display: flex;
  flex-direction: column;
  color: var(--dm-text);
  background: var(--dm-bg);
}
.num {
  font-family: var(--dm-num);
  font-variant-numeric: tabular-nums;
}

/* ---------- 顶栏 ---------- */
.pd__head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  height: 76px;
  padding: 0 24px;
  border-bottom: 1px solid var(--dm-line);
}
.pd__brand,
.pd__right {
  display: flex;
  align-items: center;
}
.pd__logo {
  display: inline-flex;
  transition: opacity 0.3s;
  &.pending {
    opacity: 0.35;
  }
}
.pd__sep {
  width: 1px;
  height: 28px;
  background: var(--dm-line);
}
.pd__brand .pd__sep {
  margin: 0 24px;
}
.pd__title {
  margin: 0;
  font-size: 24px;
  font-weight: 400;
  color: var(--dm-text);
  white-space: nowrap;
}
.pd__right {
  gap: 16px;
}
.pd__clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.1;
  b {
    font: 600 28px/1 var(--dm-num);
    font-variant-numeric: tabular-nums;
    color: var(--dm-text);
  }
  small {
    margin-top: 4px;
    @include fs(14);
    color: var(--dm-text-3);
    white-space: nowrap;
  }
}
/* 分段控件：与地图页 .seg 同款（图标 + 文字，选中实底），字号按详情页 ≥14 */
.seg {
  display: inline-flex;
  flex: none;
  padding: 2px;
  gap: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 84px;
    height: max(40px, calc(40px / var(--ui-scale, 1))); /* 顶栏放得下：屏幕上也保持 ≥ 40 */
    padding: 0 14px 0 12px;
    font: inherit;
    font-size: 16px;
    color: var(--dm-text-2);
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    &:hover:not(.on) {
      color: var(--dm-text);
      background: rgba(255, 255, 255, 0.06);
    }
    &:focus-visible {
      outline: 2px solid var(--dm-accent);
      outline-offset: 1px;
    }
    &.on {
      color: var(--dm-accent-text-on, #04121f);
      font-weight: 600;
      background: var(--dm-accent);
    }
  }
}
.seg__ic {
  flex: none;
}
.hbtn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 16px;
  font: inherit;
  font-size: 16px;
  color: var(--dm-text);
  white-space: nowrap;
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 6px;
  cursor: pointer;
  &:hover {
    border-color: var(--dm-accent);
  }
  svg {
    flex: none;
  }
}
/* 只有顶栏按钮按屏幕像素保底（76 高放得下）；面板内一律固定 40 / 44 */
.pd__right .hbtn {
  height: max(44px, calc(40px / var(--ui-scale, 1)));
}
.hbtn--back {
  min-width: 144px;
}
.hbtn--out {
  min-width: 128px;
  margin-left: -4px; /* 与「返回上一页」间距 12 */
}
.pd__error {
  position: absolute;
  top: 84px;
  left: 50%;
  z-index: 40;
  transform: translateX(-50%);
  padding: 8px 16px;
  @include fs(15);
  color: var(--dm-alarm-text, #ff8a7a);
  background: var(--pd-solid);
  border: 1px solid var(--dm-alarm);
  border-radius: 6px;
}

/* ---------- 画布：内容 y96–1056；左 1080 / 右 776 ---------- */
.pd__body {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 0;
  padding: 20px 24px 24px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.col--left {
  flex: 0 0 1080px;
}
.col--right {
  flex: 0 0 776px;
}
.box {
  position: relative;
  min-height: 0;
  background: var(--pd-panel);
  border: 1px solid var(--dm-line);
  border-radius: 10px;
}
.ttl {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--dm-text);
  white-space: nowrap;
}

/* ---------- 概览 ---------- */
.p-sum {
  flex: 0 0 232px;
  padding: 20px 24px 0;
}
.sum__top {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 44px;
}
.sum__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 28px;
  font-weight: 700;
  line-height: 44px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dm-text);
  &.long {
    font-size: 24px;
  }
}
.astrip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  font: inherit;
  @include fs(15);
  color: var(--dm-text-2);
  white-space: nowrap;
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 6px;
  cursor: pointer;
  i {
    width: 1px;
    height: 16px;
    background: var(--dm-btn-line);
  }
  b {
    font-family: var(--dm-num);
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--dm-ok);
  }
  &.on {
    color: var(--dm-alarm-text, #ffd2d2);
    border-color: var(--dm-alarm);
    b {
      color: var(--dm-alarm-text, #ffd2d2);
    }
  }
  &.err {
    color: var(--dm-warn-text, #ffc722);
    border-color: var(--dm-warn);
  }
  small.astrip__stale {
    margin-left: 8px;
    @include fs(14);
    color: var(--dm-warn-text, #ffc722);
  }
}
.live {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  font-size: 16px;
  color: var(--dm-text-2);
  white-space: nowrap;
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dm-offline);
    &.on {
      background: var(--dm-ok);
    }
    &.off {
      background: var(--dm-alarm);
    }
  }
}
.live__t {
  font-family: var(--dm-num);
  font-variant-numeric: tabular-nums;
}
.rbtn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 92px;
  height: 44px;
  font: inherit;
  font-size: 16px;
  color: var(--dm-accent);
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 6px;
  cursor: pointer;
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}
.sum__body {
  display: flex;
  height: 133px;
  margin-top: 17px;
}
.meta {
  flex: 0 0 328px;
  margin: 0;
  padding-top: 8px;
  div {
    display: flex;
    align-items: center;
    height: 38px;
  }
  dt {
    flex: 0 0 88px;
    font-size: 16px;
    color: var(--dm-text-3);
  }
  dd {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 16px;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--dm-text);
    &.num {
      @include fs(15);
    }
  }
}
.vdiv {
  flex: none;
  width: 1px;
  height: 115px;
  margin-top: 12px;
  background: var(--dm-line);
}
.rd {
  position: relative;
  flex: 1;
  display: grid;
  grid-template-columns: 150px 131px 131px 131px 130px;
  grid-template-rows: 28px 48px 1px 56px;
  align-items: start;
  margin-left: 28px;
}
.rd__label {
  padding-top: 4px;
  @include fs(15);
  line-height: 1.3;
  color: var(--dm-text-3);
}
.rd__row {
  align-self: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--dm-text);
  &--out {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-self: start;
    padding-top: 7px;
  }
  small {
    @include fs(14);
    font-weight: 400;
    color: var(--dm-text-3);
    white-space: nowrap;
  }
}
.rd__hr {
  grid-column: 1 / -1;
  height: 1px;
  background: var(--dm-line);
}
.rv {
  display: flex;
  align-items: baseline;
  padding-top: 7px;
  white-space: nowrap;
  /* 占位：缺值「—」与有数字时的基线对齐 */
  &::before {
    content: '0';
    width: 0;
    overflow: hidden;
    visibility: hidden;
    font: 600 40px/1 var(--dm-num);
  }
  b {
    font: 600 40px/1 var(--dm-num);
    font-variant-numeric: tabular-nums;
    color: var(--dm-text);
  }
  small {
    margin-left: 4px;
    font-size: 16px;
    color: var(--dm-text-2);
  }
  em {
    font: normal 500 24px/1 var(--dm-num);
    color: var(--dm-text-3);
  }
  &--out {
    padding-top: 12px;
    b {
      color: var(--dm-text-2);
    }
  }
}

/* ---------- 曲线面板 ---------- */
.p-trend {
  display: flex;
  flex: 0 0 348px;
  flex-direction: column;
  padding: 20px 24px 11px; /* 下拉弹层可以超出面板 */
}
.trend-h {
  display: flex;
  flex: none;
  align-items: center;
  height: 46px;
  .ttl {
    position: relative;
    flex: 0 0 261px;
    padding-left: 16px;
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 4px;
      height: 20px;
      margin-top: -10px;
      border-radius: 2px;
      background: var(--dm-accent);
    }
  }
  .ss {
    flex: 1 1 176px;
    width: auto !important; /* 占满指标和时间范围之间的空间，长房间名尽量显示全 */
    min-width: 176px;
    margin-left: 12px;
    @include fs(15);
  }
  :deep(.ss__btn) {
    height: 46px;
    padding: 0 14px;
    color: var(--dm-text);
    background: var(--dm-btn-bg);
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--dm-btn-line) inset;
  }
  :deep(.ss__pre) {
    color: var(--dm-text-3);
  }
  :deep(.ss__list) {
    background: var(--dm-popover-bg, #0d1b2c);
    border-color: var(--dm-btn-line);
  }
  :deep(.ss__list li) {
    height: 40px;
    padding: 0 14px;
    line-height: 40px;
  }
}
.tabs {
  display: inline-flex;
  flex: none;
  height: 46px;
  padding: 2px;
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 8px;
  /* 指标按钮按内容收窄，省下的宽度给房间 / 传感器下拉 */
  &--metric {
    button {
      min-width: 52px;
      padding: 0 10px;
    }
    &.void {
      background: none;
      border-color: transparent;
    }
  }
  &--range {
    margin-left: 12px;
  }
  button {
    flex: none;
    min-width: 58px;
    height: 40px;
    padding: 0 12px;
    font: inherit;
    @include fs(15);
    color: var(--dm-text-2);
    white-space: nowrap;
    background: transparent;
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    &.on {
      font-weight: 600;
      color: var(--dm-accent-text-on, #04121c);
      background: var(--dm-accent);
    }
  }
}
.trend-b {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-top: 9px;
}
.side {
  display: flex;
  flex: 0 0 176px;
  flex-direction: column;
  min-width: 0;
  padding: 6px 8px 8px 0;
  border-right: 1px solid var(--dm-line);
}
.side__h {
  overflow: hidden;
  @include fs(15);
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dm-text-2);
}
.side__big {
  display: flex;
  align-items: baseline;
  height: 56px;
  margin-top: 13px;
  color: var(--dm-accent);
  white-space: nowrap;
  &::before {
    content: '0';
    width: 0;
    overflow: hidden;
    visibility: hidden;
    font: 600 56px/1 var(--dm-num);
  }
  b {
    font: 600 56px/1 var(--dm-num);
    font-variant-numeric: tabular-nums;
  }
  small {
    margin-left: 6px;
    font-size: 16px;
    color: var(--dm-text-2);
  }
  em {
    font: normal 500 24px/1 var(--dm-num);
    color: var(--dm-text-3);
  }
}
.side__cap {
  margin-top: 4px;
  @include fs(14);
  white-space: nowrap;
  color: var(--dm-text-3);
}
.side__stats {
  margin: auto 10px 0 0;
  div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    height: 29px;
    line-height: 29px;
  }
  dt {
    @include fs(15);
    color: var(--dm-text-3);
  }
  dd {
    margin: 0;
    font: 500 18px/29px var(--dm-num);
    font-variant-numeric: tabular-nums;
    color: var(--dm-text);
    &.dash {
      font-size: 24px;
      color: var(--dm-text-3);
    }
  }
}
.chart {
  position: relative;
  flex: 1;
  min-width: 0;
  margin-left: 15px;
  :deep(.echart) {
    width: 100%;
    height: 100%;
  }
}
.chart__msg {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 16px;
  color: var(--dm-text-3);
}
.msg-btn {
  height: 40px;
  min-width: 72px;
  margin-left: 12px;
  padding: 0 14px;
  font: inherit;
  @include fs(15);
  color: var(--dm-accent);
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 6px;
  cursor: pointer;
}
.empty {
  padding: 16px;
  @include fs(15);
  color: var(--dm-text-3);
  text-align: center;
}

/* ---------- 设备运行系统 ---------- */
.p-eq {
  flex: 1;
  padding: 24px 16px 0;
}
.eq-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  margin: 0 4px 12px;
  .ttl {
    position: relative;
    padding-left: 16px;
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 4px;
      height: 20px;
      margin-top: -10px;
      border-radius: 2px;
      background: var(--dm-accent);
    }
  }
}
.eq-sum {
  display: flex;
  gap: 18px;
  font-size: 16px;
  color: var(--dm-text-2);
  b {
    font-family: var(--dm-num);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--dm-text);
  }
  span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}
.eq-stale {
  @include fs(14);
  color: var(--dm-warn-text, #ffc722);
}
.eq-dot {
  flex: none;
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  vertical-align: 1px;
  &.on {
    background: var(--dm-ok);
  }
  &.off {
    background: var(--dm-offline);
  }
}
.eq-wrap {
  height: 868px; /* 表头 36 + 16 行 × 52 */
  overflow: hidden;
  &.paged {
    height: 820px; /* 表头 36 + 16 行 × 49 */
  }
}
.eq {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  th {
    height: 36px;
    padding: 0 0 0 12px;
    @include fs(14);
    font-weight: 400;
    text-align: left;
    color: var(--dm-text-3);
    background: var(--dm-th-bg);
    &:first-child {
      border-radius: 6px 0 0 6px;
    }
    &:last-child {
      border-radius: 0 6px 6px 0;
    }
  }
  td {
    height: 52px;
    padding: 0 0 0 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-bottom: 1px solid var(--dm-line);
  }
}
.eq-wrap.paged .eq td {
  height: 49px;
}
.eq-st {
  @include fs(14);
  color: var(--dm-text-2);
}
.eq-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--dm-text);
}
.eq-id {
  @include fs(14);
  font-family: var(--dm-num);
  font-variant-numeric: tabular-nums;
  color: var(--dm-text-2);
}
.eq-cat {
  @include fs(14);
  color: var(--dm-text-2);
}
.eq tr.off .eq-st,
.eq tr.off .eq-name,
.eq tr.off .eq-cat {
  color: var(--dm-text-3);
}
.act {
  width: 82px;
  height: 40px;
  font: inherit;
  @include fs(15);
  color: var(--dm-accent);
  background: transparent;
  border: 1px solid var(--dm-btn-line);
  border-radius: 4px;
  cursor: pointer;
  & + & {
    margin-left: 8px;
  }
  &:hover {
    border-color: var(--dm-accent);
  }
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  button {
    width: 40px;
    height: 40px;
    font: inherit;
    @include fs(14);
    font-family: var(--dm-num);
    color: var(--dm-text-2);
    background: var(--dm-btn-bg);
    border: 1px solid var(--dm-btn-line);
    border-radius: 6px;
    cursor: pointer;
    &.on {
      font-weight: 600;
      color: var(--dm-accent-text-on, #04121c);
      background: var(--dm-accent);
      border-color: var(--dm-accent);
    }
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
    &[aria-label] {
      font-size: 22px;
      line-height: 1;
    }
  }
}

/* ---------- 告警列表 / 抽屉 ---------- */
.astrip__list {
  position: fixed;
  z-index: 80;
  width: min(600px, 90vw);
  max-height: 320px;
  margin: 0;
  padding: 6px 12px;
  overflow: auto;
  list-style: none;
  font-size: 14px;
  color: var(--dm-text);
  background: var(--dm-popover-bg, #0d1b2c);
  border: 1px solid var(--dm-btn-line);
  border-radius: 8px;
  box-shadow: var(--dm-shadow-pop, 0 12px 32px rgba(0, 0, 0, 0.5));
  li.note {
    display: block;
    padding: 8px 6px;
    color: var(--dm-warn-text, #ffc722);
  }
  li {
    display: grid;
    grid-template-columns: 96px 1fr;
    column-gap: 8px;
    padding: 8px 6px;
    border-bottom: 1px solid var(--dm-line);
    border-left: 2px solid transparent;
    &.on {
      border-left-color: var(--dm-alarm);
    }
    &:last-child {
      border-bottom: 0;
    }
    &.empty {
      display: block;
      color: var(--dm-text-3);
    }
  }
  .t {
    grid-row: span 2;
    font-family: var(--dm-num);
    font-variant-numeric: tabular-nums;
    color: var(--dm-text-3);
  }
  .d {
    color: var(--dm-text);
  }
  .c {
    color: var(--dm-text-2);
    small {
      margin-left: 8px;
      font-size: 14px;
    }
  }
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  width: 800px;
  color: var(--dm-text);
  background: var(--pd-solid);
  border-left: 1px solid var(--dm-line);
  box-shadow: var(--dm-shadow-pop, -8px 0 24px rgba(0, 0, 0, 0.5));
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 88px;
    padding: 0 24px;
    border-bottom: 1px solid var(--dm-line);
    b {
      font-size: 24px;
      font-weight: 700;
      color: var(--dm-text);
    }
  }
  .hbtn {
    min-width: 96px;
  }
  .empty {
    padding: 40px 0;
    font-size: 18px;
  }
}
.drawer__ttl {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  small {
    @include fs(15);
    color: var(--dm-text-3);
  }
}
.drawer__body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr; /* 两列（同平台抽屉）：条目多时也尽量一屏看完 */
  column-gap: 40px;
  align-content: start;
  padding: 12px 24px 24px;
  overflow: auto;
}
.drawer__hero {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
  padding: 20px 24px;
  background: var(--dm-btn-bg);
  border: 1px solid var(--dm-btn-line);
  border-radius: 10px;
  span {
    font-size: 16px;
    color: var(--dm-text-3);
  }
  b {
    font: 600 64px/1 var(--dm-num);
    font-variant-numeric: tabular-nums;
    color: var(--dm-accent);
  }
  small {
    margin-left: 8px;
    font: 500 24px var(--dm-font);
    color: var(--dm-text-2);
  }
}
.drawer__row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  padding: 11px 0;
  border-bottom: 1px solid var(--dm-line);
  span {
    flex: none;
    font-size: 16px;
    color: var(--dm-text-3);
  }
  b {
    min-width: 0;
    margin-left: auto;
    font-family: var(--dm-num);
    font-size: 20px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--dm-text);
    text-align: right;
    overflow-wrap: anywhere;
  }
}
.drawer__note {
  padding: 11px 0;
  font-size: 16px;
  color: var(--dm-text-2);
  border-bottom: 1px solid var(--dm-line);
}
.drawer__group {
  grid-column: 1 / -1;
  margin: 18px 0 6px;
  padding-left: 10px;
  font-size: 18px;
  font-weight: 700;
  color: var(--dm-text);
  border-left: 3px solid var(--dm-accent);
}

/* ---------- 亮色：其余全走 token，这里只放 token 管不到的 ---------- */
:root[data-theme='light'] {
  .seg {
    background: rgba(16, 33, 58, 0.06);
    button:hover:not(.on) {
      background: rgba(16, 33, 58, 0.06);
    }
    button.on:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--dm-focus);
    }
  }
}
</style>
