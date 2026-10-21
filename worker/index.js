// dealer-map Worker：静态 SPA + /api 只读代理（→ 平台 /v1）+ 高德安全密钥代理（/_AMapService）
const API_ORIGIN = 'https://control.cosyhome.com.cn/v1'

// 只放行前端实际调用的接口（src/api/*），其余 404
const API_ALLOW = [
  /^\/auth\/login$/,
  /^\/auth\/refresh$/,
  /^\/me$/,
  /^\/distributor\/[^/]+$/,
  /^\/projects$/,
  /^\/ctrl\/projects$/,
  /^\/project\/new-list$/,
]

const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
}

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v)
  return r
}

const notFound = () => withHeaders(new Response('Not Found', { status: 404 }), { 'Cache-Control': 'no-store' })

async function proxyApi(request, url) {
  const path = url.pathname.slice(4) // strip "/api"
  if (!API_ALLOW.some((re) => re.test(path))) return notFound()
  if (!['GET', 'POST'].includes(request.method)) return notFound()
  const headers = new Headers()
  for (const h of ['authorization', 'content-type', 'accept']) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const init = { method: request.method, headers, redirect: 'manual' }
  if (request.method === 'POST') init.body = request.body
  const upstream = await fetch(API_ORIGIN + path + url.search, { ...init, cf: { cacheTtl: 0, cacheEverything: false } })
  const res = withHeaders(upstream, { 'Cache-Control': 'no-store' })
  res.headers.delete('set-cookie')
  return res
}

async function proxyAmap(request, url, env) {
  if (!env.AMAP_JSCODE) return withHeaders(new Response('AMap proxy not configured', { status: 503 }))
  if (!['GET', 'POST'].includes(request.method)) return notFound()
  const rest = url.pathname.slice('/_AMapService'.length) || '/'
  let target
  if (rest.startsWith('/v4/map/styles')) target = 'https://webapi.amap.com' + rest
  else if (rest.startsWith('/v3/vectormap')) target = 'https://fmap01.amap.com' + rest
  else target = 'https://restapi.amap.com' + rest
  const q = new URLSearchParams(url.search)
  q.delete('jscode')
  q.set('jscode', env.AMAP_JSCODE)
  const headers = new Headers()
  for (const h of ['content-type', 'accept']) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const init = { method: request.method, headers }
  if (request.method === 'POST') init.body = request.body
  const upstream = await fetch(`${target}?${q}`, init)
  const res = withHeaders(upstream, { 'Cache-Control': 'no-store' })
  res.headers.delete('set-cookie')
  // JS API 以 JSONP（<script>）调用，上游回 text/plain；配合 nosniff 必须改成 JS 类型，否则浏览器拒绝执行
  if (q.has('callback')) res.headers.set('Content-Type', 'application/javascript; charset=utf-8')
  return res
}

// 共享小区坐标缓存：/geo-shared → Aliyun FC cosyhome-dealermap-geo /geo（URL 存 Worker secret GEO_FC_URL）
async function proxyGeo(request, env) {
  if (!env.GEO_FC_URL) return withHeaders(new Response('geo cache not configured', { status: 503 }))
  if (!['GET', 'POST'].includes(request.method)) return notFound()
  const headers = new Headers()
  for (const h of ['authorization', 'content-type', 'if-none-match']) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  const init = { method: request.method, headers }
  if (request.method === 'POST') {
    const body = await request.text()
    if (body.length > 2048) return withHeaders(new Response('too large', { status: 413 }))
    init.body = body
  }
  const upstream = await fetch(env.GEO_FC_URL.replace(/\/$/, '') + '/geo', init)
  const res = withHeaders(upstream)
  if (!res.headers.get('cache-control')) res.headers.set('Cache-Control', 'no-store')
  res.headers.delete('set-cookie')
  return res
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxyApi(request, url)
    if (url.pathname.startsWith('/_AMapService/')) return proxyAmap(request, url, env)
    if (url.pathname === '/geo-shared') return proxyGeo(request, env)
    if (!['GET', 'HEAD'].includes(request.method)) return notFound()
    const res = await env.ASSETS.fetch(request)
    return withHeaders(res)
  },
}
