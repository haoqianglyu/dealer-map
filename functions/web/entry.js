// 经销商项目地图（阿里云 FC 3.0, Node.js 20, 事件式 HTTP 触发器）：静态页面 + 接口转发，一个函数。
// 转发规则全部在 ../../worker/core.js（与 Cloudflare Worker 共用同一份）；这里只做 FC 事件 <-> Fetch API 的适配、
// 静态资源（打包在函数里的 public/）和响应压缩。esbuild 打成单个 index.js（deploy.sh）。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { brotliCompress, gzip, constants as zc } from 'node:zlib'
import { promisify } from 'node:util'
import { join, extname } from 'node:path'
import { createApp } from '../../worker/core.js'
import geoSeed from '../../worker/data/geo-seed.json'
import geoOverrides from '../../worker/data/geo-overrides.json'

// 打包后（cjs）静态文件在 index.js 同目录的 public/；测试时用 PUBLIC_DIR 指向 dist/
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(typeof __dirname === 'undefined' ? '.' : __dirname, 'public')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.map': 'application/json; charset=utf-8',
}
const COMPRESSIBLE = /^(text\/|application\/(json|javascript)|image\/svg)/

// ---- 静态资源（启动时索引 public/；路径只能命中索引内的文件，天然无目录穿越）
const files = new Map() // '/assets/x.js' -> { buf, type, etag }
const readIf = (p) => (existsSync(p) ? readFileSync(p) : null)
;(function walk(dir, prefix) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, prefix + name + '/')
    else if (/\.(br|gz)$/.test(name)) continue // 预压缩产物：跟着原文件一起读（构建期生成，见 precompress.mjs）
    else {
      const buf = readFileSync(p)
      files.set('/' + prefix + name, { buf, br: readIf(p + '.br'), gzip: readIf(p + '.gz'), type: TYPES[extname(name).toLowerCase()] || 'application/octet-stream', etag: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"' })
    }
  }
})(PUBLIC_DIR, '')

// 与 Cloudflare Assets（not_found_handling = single-page-application）一致：找不到文件就回 index.html（200）
// 地图轮廓（388 个城市）不打进函数包：放在 OSS（公开读，deploy.sh 上传），这里同源转发，页面请求路径不变
const MAP_ORIGIN = (process.env.MAP_ORIGIN || 'https://cosyhome-dealermap-wx.oss-cn-hangzhou.aliyuncs.com/dealermap').replace(/\/$/, '')
const MAP_RE = /^\/map\/city\/\d{6}\.json$/
const mapCache = new Map() // path -> { buf, etag }（实例内 LRU，最多 40 个城市，避免内存涨）
async function fetchMap(path) {
  if (mapCache.has(path)) {
    const hit = mapCache.get(path)
    mapCache.delete(path)
    mapCache.set(path, hit)
    return hit
  }
  const r = await fetch(MAP_ORIGIN + path, { signal: AbortSignal.timeout(8000) })
  if (r.status === 404) return { missing: true }
  if (!r.ok) throw new Error(`oss ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const entry = { buf, etag: '"' + createHash('sha1').update(buf).digest('hex').slice(0, 20) + '"' }
  mapCache.set(path, entry)
  if (mapCache.size > 40) mapCache.delete(mapCache.keys().next().value)
  return entry
}
const assets = {
  async fetch(request) {
    let path
    try { path = decodeURIComponent(new URL(request.url).pathname) } catch { path = '/' }
    if (MAP_RE.test(path) && !files.has(path)) { // 包里有轮廓时直接走静态文件；没有才回源
      let m
      try { m = await fetchMap(path) } catch (e) { console.error('map fetch failed', e && e.message); return new Response(JSON.stringify({ error: 'map unavailable' }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }) }
      if (m.missing) return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } })
      const headers = { 'content-type': 'application/json; charset=utf-8', etag: m.etag, 'cache-control': 'public, max-age=86400' }
      if (request.headers.get('if-none-match') === m.etag) return new Response(null, { status: 304, headers: { etag: m.etag } })
      return new Response(request.method === 'HEAD' ? null : m.buf, { status: 200, headers })
    }
    let f = files.get(path) || files.get(path.replace(/\/$/, '') + '/index.html')
    if (!f) f = files.get('/index.html')
    const headers = { 'content-type': f.type, etag: f.etag, 'cache-control': 'public, max-age=0, must-revalidate' }
    if (request.headers.get('if-none-match') === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } })
    return new Response(request.method === 'HEAD' ? null : f.buf, { status: 200, headers })
  },
}

// Node 的 fetch 发送流式请求体需要 duplex；Worker 不需要，所以只在适配层补
const fetchFn = (url, init = {}) => (init.body && typeof init.body !== 'string' ? fetch(url, { ...init, duplex: 'half' }) : fetch(url, init))
const app = createApp({ seed: geoSeed, overrides: geoOverrides, fetchFn })

// ---- 压缩（br 优先）：静态资源用构建期预压缩的产物，内存里的兜底结果也按 etag 缓存；动态响应异步压缩，不阻塞请求线程
const brAsync = promisify(brotliCompress)
const gzAsync = promisify(gzip)
const zcache = new Map()
const byEtag = new Map() // etag -> 静态文件（取预压缩产物）
for (const f of files.values()) byEtag.set(f.etag, f)
async function encode(buf, enc, key) {
  const pre = key && byEtag.get(key)
  if (pre && pre[enc]) return pre[enc]
  const k = key && enc + key
  if (k && zcache.has(k)) return zcache.get(k)
  const out = enc === 'br' ? await brAsync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: key ? 9 : 4 } }) : await gzAsync(buf, { level: key ? 9 : 6 })
  if (k) {
    zcache.set(k, out)
    if (zcache.size > 200) zcache.delete(zcache.keys().next().value)
  }
  return out
}

// FC 3.0 HTTP 触发器事件的查询参数在 queryParameters（已解码的对象）；部分形态才有 rawQueryString，两种都兼容。值为数组时展开成重复参数
export function queryOf(ev) {
  if (ev.rawQueryString) return ev.rawQueryString
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(ev.queryParameters || ev.queryStringParameters || {})) {
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, item == null ? '' : String(item))
  }
  return q.toString()
}

export async function handleEvent(raw) {
  let ev = {}
  try { ev = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : typeof raw === 'string' ? raw : JSON.stringify(raw || {})) || {} } catch { /* 非 JSON 事件 */ }
  const http = (ev.requestContext && ev.requestContext.http) || {}
  const method = (http.method || ev.httpMethod || 'GET').toUpperCase()
  const headers = new Headers()
  for (const [k, v] of Object.entries(ev.headers || {})) {
    try { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)) } catch { /* 非法头忽略 */ }
  }
  const rawPath = ev.rawPath || ev.path || '/'
  const qs = queryOf(ev)
  const url = `https://${headers.get('host') || 'localhost'}${rawPath}${qs ? '?' + qs : ''}`
  let body
  if (!['GET', 'HEAD'].includes(method) && ev.body) body = Buffer.from(ev.body, ev.isBase64Encoded ? 'base64' : 'utf8')
  const request = new Request(url, { method, headers, body })
  let res
  try {
    res = await app.fetch(request, { ASSETS: assets, AMAP_JSCODE: process.env.AMAP_JSCODE, GEO_FC_URL: process.env.GEO_FC_URL })
  } catch (e) {
    console.error('upstream error', e && e.message)
    res = new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  }
  let buf = Buffer.from(await res.arrayBuffer())
  const out = {}
  res.headers.forEach((v, k) => { out[k] = v })
  // 上游响应已被 fetch 解压：去掉失效的编码/长度头，再按调用方能力重新压缩
  delete out['content-encoding']; delete out['content-length']; delete out['transfer-encoding']; delete out['connection']
  const type = out['content-type'] || ''
  const ae = headers.get('accept-encoding') || ''
  if (COMPRESSIBLE.test(type) && buf.length > 1024 && res.status !== 304) {
    const enc = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null
    if (enc) { buf = await encode(buf, enc, out.etag); out['content-encoding'] = enc }
    out.vary = out.vary ? out.vary + ', Accept-Encoding' : 'Accept-Encoding'
  }
  const bin = !/^(text\/|application\/(json|javascript)|image\/svg)/.test(type) || !!out['content-encoding']
  return { statusCode: res.status, headers: out, body: method === 'HEAD' ? '' : buf.toString(bin ? 'base64' : 'utf8'), isBase64Encoded: bin && method !== 'HEAD' }
}

export const handler = (event, context, callback) => {
  const p = handleEvent(event)
  if (typeof callback === 'function') { p.then((r) => callback(null, r), (e) => callback(e)); return }
  return p
}
