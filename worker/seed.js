// 小区坐标离线种子（worker/data/geo-seed.json + geo-overrides.json）：只在登录后下发，不作为静态文件公开。
// GET /geo-shared/seed：Authorization 必须是有效平台 token —— 与 FC /geo-shared 相同的校验方式（转发到平台 /me，必须 200），
// 校验结果按 sha256(token) 在 isolate 内缓存 10 分钟。响应 private，CDN 不缓存。
const AUTH_TTL = 10 * 60 * 1000
const AUTH_RE = /^Bearer\s+\S{10,}$/i

async function tokenId(authz) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authz))
  return [...new Uint8Array(buf).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createSeedHandler({ seed, overrides, apiOrigin, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
  const body = JSON.stringify({ seed, overrides })
  const authOk = new Map() // tokenId -> 有效期
  async function checkAuth(authz) {
    if (!AUTH_RE.test(authz || '')) return false
    const id = await tokenId(authz)
    const exp = authOk.get(id)
    if (exp && exp > now()) return true
    const r = await fetchFn(`${apiOrigin}/me`, { headers: { authorization: authz }, redirect: 'manual', signal: AbortSignal.timeout(8000), cf: { cacheTtl: 0, cacheEverything: false } })
    if (r.status !== 200) return false
    if (authOk.size > 5000) authOk.clear()
    authOk.set(id, now() + AUTH_TTL)
    return true
  }
  const json = (status, data, cache) =>
    new Response(typeof data === 'string' ? data : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': cache, Vary: 'Authorization' },
    })
  return async function handleSeed(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'method not allowed' }, 'no-store')
    let ok
    try {
      ok = await checkAuth(request.headers.get('authorization'))
    } catch {
      return json(503, { error: 'auth upstream unavailable' }, 'no-store')
    }
    if (!ok) return json(401, { error: 'unauthorized' }, 'no-store')
    return json(200, request.method === 'HEAD' ? '' : body, 'private, max-age=3600')
  }
}
