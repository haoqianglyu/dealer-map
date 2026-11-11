// 共享小区坐标缓存（公司阿里云 OSS，经 Worker /geo-shared → FC cosyhome-dealermap-geo）。
// 读：启动时取一次，合并进种子（共享优先）；写：本机新确认的小区上报（只报坐标与高德名称/地址，不含户号/客户信息）。
import { session } from '../api/session.js'

const URL = '/geo-shared'
const auth = () => (session.token() ? { authorization: `Bearer ${session.token()}` } : {})

// 离线坐标种子 { seed, overrides }（worker/data/*.json）：登录后经 Worker GET /geo-shared/seed 凭 token 下发（不再是公开静态文件）。
// 失败（未登录 / 401 / 断网 / 10 s 超时）→ 两者都按空处理，不阻塞地图；失败不缓存，下次调用重试。成功后整页生命周期内复用。
let bundleP = null
let bundleAt = 0
const fetchBundle = (opts = {}) =>
  fetch(`${URL}/seed`, { headers: auth(), cache: opts.fresh ? 'no-cache' : 'default', signal: timeout(10000) }) // 响应 private, max-age=3600（Vary: Authorization）
    .then((r) => {
      if (!r.ok) throw new Error(`seed ${r.status}`)
      return r.json()
    })
export function loadSeedBundle() {
  if (!bundleP) {
    bundleP = fetchBundle()
      .then((b) => {
        bundleAt = Date.now()
        return b
      })
      .catch(() => {
        bundleP = null
        return { seed: {}, overrides: {} }
      })
  }
  return bundleP
}
// 种子包刷新：超过 TTL 才重新取；成功返回新包（调用方原子替换），失败 / 未到期返回 null，已有数据不受影响
export const SEED_TTL = 3600 * 1000
export async function refreshSeedBundle(now = Date.now()) {
  if (!bundleAt || now - bundleAt < SEED_TTL) return null
  try {
    const b = await fetchBundle({ fresh: true })
    bundleP = Promise.resolve(b)
    bundleAt = now
    return b
  } catch {
    return null
  }
}

// 共享请求是可选的：连接挂住也不能卡住定位初始化
const SHARED_TIMEOUT = 8000 // FC 冷启动 + /me 校验可能要几秒
const POST_TIMEOUT = 8000
const timeout = (ms) => AbortSignal.timeout?.(ms)

// 共享文档 → 与 geo-seed.json 相同的 key 形式：{ "区县adcode|查询串": { p, n, a, shared } | { f, ret, fp, exp, shared } }
// 失败结果带过期时间，已过期的不进来；服务端也会清理，这里兜底时钟差和旧数据
export function parseShared(d, now = Date.now()) {
  const out = {}
  for (const [k, v] of Object.entries(d?.fails || {})) {
    if (v?.r && v.exp > now) out[k] = { f: v.r, ret: v.n || v.a ? { name: v.n || '', address: v.a || '' } : null, fp: v.fp || '', exp: v.exp, shared: true }
  }
  for (const [k, v] of Object.entries(d?.points || {})) {
    if (Number.isFinite(v?.lng) && Number.isFinite(v?.lat)) out[k] = { p: [v.lng, v.lat], n: v.matched_name || '', a: v.matched_address || '', shared: true }
  }
  return out
}

// 共享结果并进种子：坐标优先于种子；失败结果绝不盖掉任何已有坐标（种子里有点就用点）
export function mergeShared(seed, shared) {
  const out = { ...seed }
  for (const [k, v] of Object.entries(shared || {})) {
    if (v.f && (out[k]?.p || Array.isArray(out[k]))) continue
    out[k] = v
  }
  return out
}

export async function loadShared() {
  try {
    const r = await fetch(URL, { headers: auth(), cache: 'no-cache', signal: timeout(SHARED_TIMEOUT) })
    if (!r.ok) return {}
    return parseShared(await r.json())
  } catch {
    return {}
  }
}

const post = (body) =>
  fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify(body), signal: timeout(POST_TIMEOUT) })
    .then((r) => r.ok)
    .catch(() => false)

export function postShared({ key, adcode, lnglat, matched, address, source }) {
  if (!key || !adcode || !lnglat) return Promise.resolve(false)
  return post({ key, adcode, lng: lnglat[0], lat: lnglat[1], matched_name: matched || '', matched_address: address || '', source: source || 'amap' })
}

// 未确认结果上报：只报明确查过但没找到的；临时错误（超时、配额、高德报错）绝不上报，否则一次抖动会挡住所有设备 7 天
export function postSharedFail({ key, adcode, reason, returned, fp, transient }) {
  if (!key || !adcode || !reason || !fp || transient) return Promise.resolve(false)
  return post({ failed: true, key, adcode, reason, matched_name: returned?.name || '', matched_address: returned?.address || '', fp })
}
