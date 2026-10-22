// 共享小区坐标缓存（公司阿里云 OSS，经 Worker /geo-shared → FC cosyhome-dealermap-geo）。
// 读：启动时取一次，合并进种子（共享优先）；写：本机新确认的小区上报（只报坐标与高德名称/地址，不含户号/客户信息）。
import { session } from '@/api/session'

const URL = '/geo-shared'
const auth = () => (session.token() ? { authorization: `Bearer ${session.token()}` } : {})

// 离线坐标种子 { seed, overrides }（worker/data/*.json）：登录后经 Worker GET /geo-shared/seed 凭 token 下发（不再是公开静态文件）。
// 失败（未登录 / 401 / 断网）→ 两者都按空处理，不阻塞地图；失败不缓存，下次调用重试。成功后整页生命周期内复用。
let bundleP = null
export function loadSeedBundle() {
  if (!bundleP) {
    bundleP = fetch(`${URL}/seed`, { headers: auth() }) // 响应 private, max-age=3600（Vary: Authorization）
      .then((r) => {
        if (!r.ok) throw new Error(`seed ${r.status}`)
        return r.json()
      })
      .catch(() => {
        bundleP = null
        return { seed: {}, overrides: {} }
      })
  }
  return bundleP
}

// 返回与 geo-seed.json 相同的 key 形式：{ "区县adcode|查询串": { p: [lng, lat], n, a, shared: true } }
export async function loadShared() {
  try {
    const r = await fetch(URL, { headers: auth(), cache: 'no-cache' })
    if (!r.ok) return {}
    const d = await r.json()
    const out = {}
    for (const [k, v] of Object.entries(d?.points || {})) {
      if (Number.isFinite(v?.lng) && Number.isFinite(v?.lat)) out[k] = { p: [v.lng, v.lat], n: v.matched_name || '', a: v.matched_address || '', shared: true }
    }
    return out
  } catch {
    return {}
  }
}

export function postShared({ key, adcode, lnglat, matched, address, source }) {
  if (!key || !adcode || !lnglat) return Promise.resolve(false)
  return fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth() },
    body: JSON.stringify({ key, adcode, lng: lnglat[0], lat: lnglat[1], matched_name: matched || '', matched_address: address || '', source: source || 'amap' }),
  })
    .then((r) => r.ok)
    .catch(() => false)
}
