import { loadSeedBundle } from './shared.js'

// 小区级地理编码：overrides → localStorage 缓存 → 高德 Geocoder / POI 搜索（限流）
// 只有「已确认」的结果才上地图：高德返回的名称/地址与归一化小区名一致（一方完整包含另一方；泛称/短名须完全一致，不做模糊匹配），
// 且落在项目所属区县 adcode 内。其余一律进「待校正」（不上图）。
// 查找顺序：geo-overrides.json（人工）→ geo-seed.json（共享种子，新设备免查询）→ localStorage 缓存 → 高德。
// 缓存 key = 归一化查询串（市+区+小区）；已确认永久缓存，未确认缓存 7 天（高德「基础搜索」月配额仅 5000 次），
// 「重新定位待校正」按钮可强制重查。只存坐标/匹配级别/高德返回的名称地址，不存任何项目/客户信息。

const CACHE_VERSION = 'v9' // v9：小区名归一化规则 v3（NORMALIZE_VERSION：市/区县前缀、叠拼、繁体、镇名）
const CACHE_KEY = `dealer-map:geo:${CACHE_VERSION}`
const FAIL_TTL = 7 * 24 * 3600 * 1000

// ---------- 名称确认 ----------
// 分期/分区（一期、3期、东区、A区、二区、东苑…）是不同的小区，可能相距很远：单独提取，必须完全一致。
const CN_DIGIT = '零一二三四五六七八九'
const toCnNum = (d) => {
  const n = Number(d)
  if (!Number.isFinite(n) || n > 99) return d
  if (n <= 10) return n === 10 ? '十' : CN_DIGIT[n]
  return (n >= 20 ? CN_DIGIT[Math.floor(n / 10)] : '') + '十' + (n % 10 ? CN_DIGIT[n % 10] : '')
}
const PHASE_RE = /([一二三四五六七八九十\d]+期|(?:[东西南北中]|[A-Za-z]|[一二三四五六七八九十\d]+)区|[东西南北中]苑)/g
export const normPhase = (t) => t.replace(/\d+/g, toCnNum).toUpperCase()
export const phasesOf = (n) => [...new Set((String(n || '').match(PHASE_RE) || []).map(normPhase))].sort().join(',')
const SUFFIX_RE = /(小区|花园|家园)+$/
const PUNCT_RE = /[（(][^）)]*[）)]|[\s·•、,，.。\-－—_]+/g
// 名称主体：去标点、去分期/分区、去「小区/花园/家园」后缀
export const coreName = (n) => {
  const s = String(n || '').replace(PUNCT_RE, '').replace(PHASE_RE, '')
  const c = s.replace(SUFFIX_RE, '')
  return c.length >= 2 ? c : s
}
// 泛称/短名（村、自建房、别墅、私宅，或名称 ≤3 字）只接受完全一致，其余要求一方完整包含另一方。不做模糊匹配。
const GENERIC_RE = /村|自建房|别墅|私宅/
export const isStrictName = (community) => GENERIC_RE.test(String(community || '')) || String(community || '').replace(PUNCT_RE, '').length <= 3
// 单个候选：'ok' 确认 | 'phase' 主体一致但分期/分区不一致或不明确 | 'no' 名称不一致
export function matchName(community, cand) {
  const raw = String(community || '').replace(PUNCT_RE, '')
  const a = coreName(community)
  if (a.length < 2 || !cand) return 'no'
  const full = String(cand).replace(PUNCT_RE, '')
  const b = coreName(cand)
  let base
  if (isStrictName(community)) base = a === b || raw === full
  // 反向（小区名包含高德名称）：高德名称须 ≥4 字且占小区名 ≥ 65%，避免「紫金山体育」→「紫金山」
  else base = full.replace(PHASE_RE, '').includes(a) || (b.length >= 4 && b.length / a.length >= 0.65 && a.includes(b))
  if (!base) return 'no'
  // 分期必须完全一致；项目没写分期而高德结果带分期 → 不明确
  return phasesOf(community) === phasesOf(cand) ? 'ok' : 'phase'
}
// community：归一化小区名（已去市区前缀）；candidates：高德返回的名称 / 地址（已去省市区前缀）
export function namesMatch(community, candidates) {
  return candidates.filter(Boolean).some((c) => matchName(community, c) === 'ok')
}
// 区县一致：有区县 adcode 时要求完全相同；只有市级时比较前 4 位
function inDistrict(adcode, group) {
  const want = String(group.district || group.city || '')
  const got = String(adcode || '')
  if (!want || !got) return false
  if (/00$/.test(want) && !group.district) return /^(11|12|31|50)/.test(want) ? got.slice(0, 2) === want.slice(0, 2) : got.slice(0, 4) === want.slice(0, 4) // 直辖市全市范围含 xx02 县
  return got === want
}
// 小区名开头带的市/区名（如「安州区典汇国际」「龙岩紫金山…」）不参与名称比对
export function stripPlace(name, g) {
  const pre = [g.cityName, g.districtName]
    .filter(Boolean)
    .flatMap((n) => [n, n.length > 2 ? n.replace(/(市|区|县)$/, '') : ''])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  let s = String(name || '')
  let prev
  do {
    prev = s
    for (const p of pre) if (s.startsWith(p) && s.length - p.length >= 2) s = s.slice(p.length)
  } while (s !== prev)
  return s
}

// 去掉「省市区」前缀，只留区县之后的部分（小区/道路名）
function stripAdmin(addr, g) {
  const a = String(addr || '')
  const i = g.districtName ? a.indexOf(g.districtName) : -1
  return i >= 0 ? a.slice(i + g.districtName.length) : a
}

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

// worker/data/geo-overrides.json：{ "无锡市滨湖区某某小区": [lng, lat] }（GCJ-02，可在高德坐标拾取器取点）
// 与种子一起登录后经 Worker GET /geo-shared/seed 下发（loadSeedBundle）；改完 wrangler deploy
export function parseOverrides(o) {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) {
    if (!k.startsWith('_') && Array.isArray(v) && v.length === 2) out[k.replace(/\s+/g, '')] = v.map(Number)
  }
  return out
}
export const loadOverrides = () => loadSeedBundle().then((b) => parseOverrides(b?.overrides))

// worker/data/geo-seed.json：共享种子 { "区县adcode|归一化查询串": { p: [lng, lat], n: 高德名称 } | [lng, lat] | { f, ret } }，
// 由开发环境「导出已确认坐标」生成 → 覆盖 worker/data/geo-seed.json（不要放回 public/）→ wrangler deploy。登录后才下发（loadSeedBundle）。
export function parseSeed(o) {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) {
    if (k.startsWith('_')) continue
    if (Array.isArray(v) && v.length === 2) out[k] = v.map(Number)
    else if (v && Array.isArray(v.p)) out[k] = { p: v.p.map(Number), n: v.n || '' } // 带高德匹配名称，便于离线复核
    else if (v && v.f) out[k] = v // 已知未确认：{ f: 原因, ret: 高德返回 }，新设备也不重复查询
  }
  return out
}
export const loadSeed = () => loadSeedBundle().then((b) => parseSeed(b?.seed))
export const seedKey = (district, query) => `${district || ''}|${query}`

// 不访问网络的查找：override → seed → 缓存（已确认；或 7 天内的未确认结果）。
// 种子/缓存里的已确认结果按当前规则离线复核（有匹配名称时复核名称；无名称时泛称/短名一律待校正），不发请求。
export function lookupLocal(group, overrides, seed = {}, { ignoreSeedFail = false } = {}) {
  const { queries } = group
  const district = group.district || group.city // 全市范围查询（名称前缀只给出市）的种子 / 共享 key 用市 adcode
  const c = loadCache()
  const kwOf = (i) => stripPlace(group.keywords?.[i] || group.community, group)
  // 无匹配名称（旧种子）时无法核对：泛称/短名、带分期的一律待校正
  const recheck = (i, matched) => (matched ? namesMatch(kwOf(i), [matched]) : !isStrictName(kwOf(i)) && !phasesOf(kwOf(i)))
  const rejected = (q, matched) => ({
    fail: true,
    reason: matched ? '名称不一致' : '名称过短/泛称或带分期，需人工确认',
    returned: matched ? { name: matched, address: '' } : null,
    source: 'recheck',
    query: q,
  })
  for (const q of queries) {
    if (overrides[q]) return { lnglat: overrides[q], level: '人工校正', source: 'override', query: q }
  }
  let firstReject = null
  for (const [i, q] of queries.entries()) {
    const hit = seed[seedKey(district, q)]
    const pt = Array.isArray(hit) ? hit : hit?.p
    if (!pt) continue
    if (recheck(i, hit.n)) return { lnglat: pt, level: hit.shared ? '共享缓存' : '种子', matched: hit.n || '', address: hit.a || '', source: hit.shared ? 'shared' : 'seed', query: q }
    firstReject = firstReject || rejected(q, hit.n)
  }
  for (const [i, q] of queries.entries()) {
    const hit = c[q]
    if (!hit?.p) continue
    if (recheck(i, hit.n)) return { lnglat: hit.p, level: hit.l, matched: hit.n || '', address: hit.a || '', source: 'cache', query: q }
    firstReject = firstReject || rejected(q, hit.n)
  }
  if (firstReject && !ignoreSeedFail) return firstReject
  const key = queries[0]
  const f = key && c[key]
  if (f?.f && Date.now() - f.t < FAIL_TTL) return { fail: true, reason: f.r, returned: f.ret || null, source: 'cache' }
  const sf = !ignoreSeedFail && key && seed[seedKey(district, key)]
  if (sf?.f) return { fail: true, reason: sf.f, returned: sf.ret || null, source: 'seed', query: key }
  return null
}

// 「重新定位待校正」：删掉这些查询串的未确认缓存
export function forgetFailures(queries) {
  const c = loadCache()
  for (const q of queries) delete c[q]
  saveCache()
}

// 开发用：把已确认结果导出为 worker/data/geo-seed.json 格式
export function exportSeed(entries) {
  const out = { _readme: '共享定位种子：key = 区县adcode|归一化查询串（市+区+小区，无户号），value = [lng, lat]（GCJ-02）。由开发环境「导出已确认坐标」生成 → 覆盖 worker/data/geo-seed.json（登录后经 /geo-shared/seed 下发，不放 public/）→ wrangler deploy。' }
  for (const [k, v] of entries.sort((a, b) => a[0].localeCompare(b[0], 'zh'))) out[k] = v
  return out
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

// 限流队列：并发 ≤ concurrency；全局 ≤ qps 次/秒（高德个人 Key 地理编码/搜索 QPS 上限 3）；
// maxSearches：关键字搜索（「基础搜索」月配额 5000）本轮上限，超出后跳过 POI 兜底（按临时未定位处理，不缓存）
export function createGeocodeQueue(AMap, { concurrency = 3, qps = 2.8, maxSearches = Infinity, onResult, onFatal } = {}) {
  let nextSlot = 0
  const slot = () => {
    const now = Date.now()
    const at = Math.max(now, nextSlot)
    nextSlot = at + 1000 / qps
    return new Promise((r) => setTimeout(r, at - now))
  }
  let searches = 0
  const geocoders = new Map() // 每个区县 adcode 一个 Geocoder（city 参数限定匹配范围）
  const getGeocoder = (city) => {
    if (!geocoders.has(city)) geocoders.set(city, new AMap.Geocoder({ city: city || '全国' }))
    return geocoders.get(city)
  }
  const searchers = new Map() // 小区名 POI 搜索（Geocoder 只给到区县/道路级时的兜底），限定在本区县
  const getSearcher = (city) => {
    if (!searchers.has(city)) searchers.set(city, new AMap.PlaceSearch({ city: city || '全国', citylimit: Boolean(city), pageSize: 5, extensions: 'all' }))
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

  const pt = (loc) => {
    const l = Array.isArray(loc) ? { lng: loc[0], lat: loc[1] } : loc
    return [Number(Number(l.lng).toFixed(6)), Number(Number(l.lat).toFixed(6))]
  }
  const confirm = (q, p, level, matched, address = '') => {
    c[q] = { p, l: level, n: matched, a: address, t: Date.now() }
    saveCache()
    return { lnglat: p, level, matched, address, source: 'amap', query: q }
  }

  async function resolveGroup(group) {
    let best = null // 未确认时展示「高德返回了什么」：{ name, address, adcode, why }
    let transient = false
    const note = (cand) => {
      if (!best || (!best.name && cand.name)) best = cand
    }
    // 第一步：Geocoder（限定区县）
    for (const [i, q] of group.queries.entries()) {
      const kw = stripPlace(group.keywords?.[i] || group.community, group)
      await slot()
      const { status, result } = await geocodeOnce(getGeocoder(group.geoCity), q)
      if (fatal(status, result)) return null
      if (status === 'error') {
        transient = true
        note({ why: `高德返回错误 ${typeof result === 'string' ? result : result?.info || ''}`.trim() })
        continue
      }
      const g = status === 'complete' ? result?.geocodes?.[0] : null
      if (!g) continue
      const addr = g.formattedAddress || g.formatted_address || '' // JS API 2.0 为 formattedAddress
      const tail = stripAdmin(addr, group)
      const okDistrict = inDistrict(g.adcode, group)
      const okLevel = GOOD_LEVELS.has(g.level)
      const m = okLevel ? matchName(kw, tail) : 'no'
      if (okDistrict && m === 'ok') return confirm(q, pt(g.location), g.level, tail, addr)
      note({ name: '', address: addr, adcode: g.adcode, why: !okLevel ? `仅匹配到${g.level}` : !okDistrict ? '不在本区' : m === 'phase' ? '分期/分区不一致或不明确' : '名称不一致' })
    }
    // 第二步：按小区名做 POI 搜索（限定区县）
    for (const [i, kw] of (group.keywords || []).entries()) {
      const q = group.queries[i]
      if (searches >= maxSearches) {
        transient = true
        note({ why: '本轮搜索配额已用完' })
        break
      }
      searches++
      await slot()
      const { status, result } = await searchOnce(getSearcher(group.geoCity), kw)
      if (fatal(status, result)) return null
      if (status === 'error') {
        transient = true
        note({ why: `高德返回错误 ${typeof result === 'string' ? result : result?.info || ''}`.trim() })
        continue
      }
      const pois = (status === 'complete' && result?.poiList?.pois) || []
      const withLoc = pois.filter((p) => p.location)
      const name = stripPlace(kw, group)
      const inDist = withLoc.filter((p) => inDistrict(p.adcode, group))
      const ok = inDist.filter((p) => matchName(name, p.name) === 'ok')
      const phased = inDist.filter((p) => matchName(name, p.name) === 'phase')
      // 项目没写分期、而区内同名小区有多个分期 → 不明确，进待校正并列出候选
      if (ok.length && (phasesOf(name) || !phased.length)) return confirm(q, pt(ok[0].location), '兴趣点(POI)', ok[0].name, [ok[0].adname, ok[0].address].filter((x) => x && typeof x === 'string').join(''))
      if (ok.length || phased.length) {
        best = { name: [...ok, ...phased].map((p) => p.name).slice(0, 4).join('、'), address: '', why: '分期/分区不一致或不明确' }
        continue
      }
      const top = withLoc[0]
      if (top) note({ name: top.name, address: [top.adname, top.address].filter((x) => x && typeof x === 'string').join(''), adcode: top.adcode, why: inDistrict(top.adcode, group) ? '名称不一致' : '不在本区' })
    }
    const returned = best && (best.name || best.address) ? { name: best.name || '', address: best.address || '' } : null
    const reason = best?.why || '未找到'
    if (!transient && group.queries[0]) {
      c[group.queries[0]] = { f: 1, r: reason, ret: returned, t: Date.now() } // 未确认也缓存 7 天，省配额
      saveCache()
    }
    return { fail: true, transient, returned, reason: reason + (transient ? '（高德临时错误，下次加载重试）' : '') }
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
    get searches() {
      return searches
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
