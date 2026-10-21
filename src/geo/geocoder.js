// 小区级地理编码：overrides → localStorage 缓存 → 高德 Geocoder（限流）→ 区县中心兜底
// 缓存 key = 归一化查询串（市+区+小区），只存坐标与匹配级别，不存任何项目/客户信息。

const CACHE_VERSION = 'v5'
const CACHE_KEY = `dealer-map:geo:${CACHE_VERSION}`
const FAIL_TTL = 7 * 24 * 3600 * 1000 // 未匹配结果 7 天后重试

// 认为是「小区级」可信的匹配级别；其余（区县/乡镇/道路/村庄…）视为未精确匹配
export const GOOD_LEVELS = new Set(['兴趣点', '门牌号', '单元号', '道路交叉路口', '小区', '住宅区', '楼栋'])

let cache = null
function loadCache() {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}
  } catch {
    cache = {}
  }
  // 清理旧版本缓存
  Object.keys(localStorage)
    .filter((k) => k.startsWith('dealer-map:geo:') && k !== CACHE_KEY)
    .forEach((k) => localStorage.removeItem(k))
  return cache
}
let saveTimer = null
function saveCache() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch (e) {
      console.warn('地理编码缓存写入失败', e?.message)
    }
  }, 500)
}
export function clearGeoCache() {
  cache = {}
  localStorage.removeItem(CACHE_KEY)
}

// public/geo-overrides.json：{ "无锡市滨湖区某某小区": [lng, lat] }（GCJ-02，可在高德坐标拾取器取点）
let overridesP = null
export function loadOverrides() {
  if (!overridesP) {
    overridesP = fetch(`${import.meta.env.BASE_URL}geo-overrides.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((o) => {
        const out = {}
        for (const [k, v] of Object.entries(o || {})) {
          if (!k.startsWith('_') && Array.isArray(v) && v.length === 2) out[k.replace(/\s+/g, '')] = v.map(Number)
        }
        return out
      })
  }
  return overridesP
}

// 不访问网络的查找：override 或有效缓存
export function lookupLocal(queries, overrides) {
  const c = loadCache()
  for (const q of queries) {
    if (overrides[q]) return { lnglat: overrides[q], level: '人工校正', source: 'override', query: q }
  }
  for (const q of queries) {
    const hit = c[q]
    if (hit?.p) return { lnglat: hit.p, level: hit.l, source: 'cache', query: q }
  }
  const allFailed = queries.length > 0 && queries.every((q) => c[q]?.f && Date.now() - c[q].t < FAIL_TTL)
  return allFailed ? { fail: true, reason: c[queries[0]].r || '未匹配到小区' } : null
}

const KEY_ERRORS = /KEY|PLAT|SIGNATURE|DOMAIN|SECURITY|OVER_LIMIT|OVER_QUOTA|ACCESS_TOO_FREQUENT|IP_QUERY/i

// 高德回调偶尔不触发：8 秒超时按临时错误处理（不写缓存，下次再试）
function withTimeout(run, ms = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ status: 'error', result: 'TIMEOUT' }), ms)
    run((status, result) => {
      clearTimeout(t)
      resolve({ status, result })
    })
  })
}
const geocodeOnce = (geocoder, query) => withTimeout((cb) => geocoder.getLocation(query, cb))
const searchOnce = (placeSearch, keyword) => withTimeout((cb) => placeSearch.search(keyword, cb))

// POI 结果里优先取名称包含小区名、类型为住宅的那条
function pickPoi(pois, keyword, city) {
  // extensions:'base' 的 POI 不带 adcode；搜索已用 citylimit 限定在区县内，有 adcode 时再校验一次
  const inCity = (pois || []).filter((p) => p.location && (!p.adcode || String(p.adcode).slice(0, 4) === String(city).slice(0, 4)))
  // 名称必须互相包含（如「万科城市花园」↔「万科城市花园二区」），否则视为没搜到，避免误定位
  const core = (n) => String(n || '').replace(/[(（].*$/, '').replace(/([一二三四五六七八九十\d]+期|[A-Z东西南北一二三四五六七八九十\d]+区)$/, '')
  const nameMatch = (p) => String(p.name).includes(keyword) || (core(p.name).length >= 2 && keyword.includes(core(p.name)))
  const score = (p) => (String(p.name).startsWith(keyword) ? 2 : 0) + (/住宅|小区|别墅/.test(p.type || '') ? 1 : 0)
  return inCity.filter(nameMatch).sort((a, b) => score(b) - score(a))[0] || null
}

// 创建限流队列：并发 ≤ concurrency，每个请求后间隔 gap 毫秒
export function createGeocodeQueue(AMap, { concurrency = 3, gap = 200, onResult, onFatal } = {}) {
  const geocoders = new Map() // 每个区县 adcode 一个 Geocoder（city 参数限定匹配范围）
  const getGeocoder = (city) => {
    if (!geocoders.has(city)) geocoders.set(city, new AMap.Geocoder({ city: city || '全国' }))
    return geocoders.get(city)
  }
  const searchers = new Map() // 小区名 POI 搜索（Geocoder 只给到区县/道路级时的兜底），限定在本区县
  const getSearcher = (city) => {
    if (!searchers.has(city)) searchers.set(city, new AMap.PlaceSearch({ city: city || '全国', citylimit: Boolean(city), pageSize: 5, extensions: 'base' }))
    return searchers.get(city)
  }
  const fatal = (status, result) => {
    if (status !== 'error') return false
    const info = typeof result === 'string' ? result : result?.info || 'error'
    if (!KEY_ERRORS.test(info)) return false
    stopped = true
    onFatal && onFatal(info)
    return true
  }
  const pending = []
  let running = 0
  let stopped = false
  const c = loadCache()

  async function resolveGroup(group) {
    let lastReason = '未匹配到小区'
    let transient = false
    for (const q of group.queries) {
      const { status, result } = await geocodeOnce(getGeocoder(group.geoCity), q)
      await new Promise((r) => setTimeout(r, gap))
      if (fatal(status, result)) return null
      if (status === 'error') {
        transient = true
        lastReason = `高德返回错误 ${typeof result === 'string' ? result : result?.info}`
        continue // 临时错误：不写缓存
      }
      const g = status === 'complete' ? result?.geocodes?.[0] : null
      const sameCity = g && group.city && String(g.adcode || '').slice(0, 4) === String(group.city).slice(0, 4)
      if (g && GOOD_LEVELS.has(g.level) && sameCity) {
        const p = [Number(g.location.lng.toFixed(6)), Number(g.location.lat.toFixed(6))]
        c[q] = { p, l: g.level, t: Date.now() }
        saveCache()
        return { lnglat: p, level: g.level, source: 'amap', query: q }
      }
      lastReason = g ? (sameCity ? `匹配级别过粗（${g.level}）` : '匹配结果不在本市') : '未匹配到小区'
    }
    // 第二步：按小区名做 POI 搜索（限定区县）
    for (const [i, kw] of (group.keywords || []).entries()) {
      const q = group.queries[i]
      const { status, result } = await searchOnce(getSearcher(group.geoCity), kw)
      await new Promise((r) => setTimeout(r, gap))
      if (fatal(status, result)) return null
      if (status === 'error') transient = true
      const poi = status === 'complete' ? pickPoi(result?.poiList?.pois, kw, group.city) : null
      if (poi) {
        const loc = Array.isArray(poi.location) ? { lng: poi.location[0], lat: poi.location[1] } : poi.location
        const p = [Number(Number(loc.lng).toFixed(6)), Number(Number(loc.lat).toFixed(6))]
        c[q] = { p, l: '兴趣点(POI)', t: Date.now() }
        saveCache()
        return { lnglat: p, level: '兴趣点(POI)', source: 'amap', query: q }
      }
    }
    lastReason += '；小区 POI 未找到'
    if (!transient) {
      for (const q of group.queries) c[q] = { f: 1, r: lastReason, t: Date.now() }
      saveCache()
    }
    return { fail: true, reason: lastReason }
  }

  function pump() {
    while (!stopped && running < concurrency && pending.length) {
      const group = pending.shift()
      running++
      resolveGroup(group)
        .then((res) => res && onResult && onResult(group, res))
        .catch((e) => console.warn('地理编码异常', e?.message))
        .finally(() => {
          running--
          pump()
        })
    }
  }

  return {
    add(groups) {
      pending.push(...groups)
      pump()
    },
    stop() {
      stopped = true
      pending.length = 0
    },
    get size() {
      return pending.length + running
    },
  }
}

// 区县中心兜底点：按 key 做确定性小幅偏移（≈±600m），避免同区所有点完全重叠
export function jitter([lng, lat], key) {
  let h = 2166136261
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const a = ((h >>> 0) % 360) * (Math.PI / 180)
  const r = 0.002 + (((h >>> 9) % 1000) / 1000) * 0.004
  return [lng + Math.cos(a) * r, lat + Math.sin(a) * r * 0.85]
}
