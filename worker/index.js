// dealer-map Worker：静态 SPA + /api 只读代理（→ 平台 /v1）+ 高德安全密钥代理（/_AMapService）
import { createSeedHandler } from './seed.js'
import geoSeed from './data/geo-seed.json'
import geoOverrides from './data/geo-overrides.json'

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
  /^\/device-alarms$/,
  /^\/ctrl-mode\/online-project-id-list$/, // 在线项目 id（只读 GET）
  // 项目详情（二级界面）只读接口
  /^\/project\/[0-9a-f]{24}$/,
  /^\/project-config\/[0-9a-f]{24}$/,
  /^\/ctrl\/get-device-data-list$/,
  /^\/device-categories$/,
  /^\/device-models$/,
]

// 只允许 GET 的接口
const GET_ONLY = new Set(['/ctrl-mode/online-project-id-list'])

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

// 设备透传：只放行「查询」类消息（41 RoomStatusGet、40 RoomDataGet、44 AmmeterDataQuery、43 EnergyDtoQuery、
// 30 OnlineDeviceListQuery、15 DeviceDataGetQuery）；其它 message_type（含各类 Set/控制）一律 403 并记录
const CTRL_PATHS = new Set(['/ctrl-message/pass', '/ctrl-callback-result'])
const CTRL_QUERY_TYPES = new Set([41, 40, 44, 43, 30, 15])

async function proxyApi(request, url) {
  const path = url.pathname.slice(4) // strip "/api"
  if (CTRL_PATHS.has(path)) {
    if (request.method !== 'POST') return notFound()
    const text = await request.text()
    let mt = null
    try {
      mt = Number(JSON.parse(text).message_type)
    } catch {
      /* 非 JSON */
    }
    if (!CTRL_QUERY_TYPES.has(mt) || text.length > 4096) {
      console.log(JSON.stringify({ rejected: path, message_type: Number.isFinite(mt) ? mt : null })) // 只记录类型，不记录请求体
      return withHeaders(new Response(JSON.stringify({ error: 'message_type not allowed' }), { status: 403, headers: { 'content-type': 'application/json' } }), { 'Cache-Control': 'no-store' })
    }
    const headers = new Headers({ 'content-type': 'application/json' })
    const auth = request.headers.get('authorization')
    if (auth) headers.set('authorization', auth)
    const upstream = await fetch(API_ORIGIN + path, { method: 'POST', headers, body: text, redirect: 'manual' })
    const res = withHeaders(upstream, { 'Cache-Control': 'no-store' })
    res.headers.delete('set-cookie')
    return res
  }
  if (!API_ALLOW.some((re) => re.test(path))) return notFound()
  if (!['GET', 'POST'].includes(request.method)) return notFound()
  if (GET_ONLY.has(path) && request.method !== 'GET') return notFound()
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

// 登录后才下发的离线坐标种子（GET /geo-shared/seed，见 worker/seed.js）
const handleSeed = createSeedHandler({ seed: geoSeed, overrides: geoOverrides, apiOrigin: API_ORIGIN })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxyApi(request, url)
    if (url.pathname.startsWith('/_AMapService/')) return proxyAmap(request, url, env)
    if (url.pathname === '/geo-shared') return proxyGeo(request, env)
    if (url.pathname === '/geo-shared/seed') return withHeaders(await handleSeed(request))
    if (!['GET', 'HEAD'].includes(request.method)) return notFound()
    const res = await env.ASSETS.fetch(request)
    // /assets/* 缺文件时不能走 SPA 回退返回 index.html（浏览器会把 HTML 当 JS 缓存，页面白屏）
    if (url.pathname.startsWith('/assets/')) {
      if ((res.headers.get('content-type') || '').includes('text/html')) {
        return withHeaders(new Response('Not Found', { status: 404 }), { 'Cache-Control': 'no-store' })
      }
      return withHeaders(res, { 'Cache-Control': 'public, max-age=31536000, immutable' }) // 文件名带内容哈希
    }
    // 带扩展名的静态文件（favicon.ico、*.png 等）缺失时同样 404，不回 index.html
    if (/\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname) && (res.headers.get('content-type') || '').includes('text/html')) {
      return withHeaders(new Response('Not Found', { status: 404 }), { 'Cache-Control': 'no-store' })
    }
    if (/^\/(favicon[^/]*|apple-touch-icon\.png)$/.test(url.pathname)) return withHeaders(res, { 'Cache-Control': 'public, max-age=86400' })
    // HTML 入口每次都向服务器确认，部署后立即拿到新版本
    if ((res.headers.get('content-type') || '').includes('text/html')) return withHeaders(res, { 'Cache-Control': 'no-cache' })
    return withHeaders(res)
  },
}
