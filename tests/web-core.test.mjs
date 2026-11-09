// worker/core.js（Worker 与 FC 共用）的转发规则 + FC 适配层（functions/web/entry.js）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createApp } from '../worker/core.js'

function setup(env = {}) {
  const calls = []
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init })
    return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } })
  }
  const assets = { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) }
  const app = createApp({ seed: {}, overrides: {}, fetchFn })
  const call = (path, init) => app.fetch(new Request('https://x' + path, init), { ASSETS: assets, ...env })
  return { calls, call }
}
const post = (b, extra = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t', ...extra }, body: typeof b === 'string' ? b : JSON.stringify(b) })

test('api allowlist: unknown path / non-allowed method → 404, nothing forwarded', async () => {
  const { call, calls } = setup()
  for (const [p, init] of [['/api/users', {}], ['/api/me/x', {}], ['/api/project/zz', {}], ['/api/ctrl-mode/online-project-id-list', { method: 'POST' }], ['/api/me', { method: 'DELETE' }], ['/api/me', { method: 'PUT' }]]) {
    assert.equal((await call(p, init)).status, 404, p)
  }
  assert.equal(calls.length, 0)
})

test('api: allowed path forwards only authorization/content-type/accept, strips set-cookie, no-store + security headers', async () => {
  const { call, calls } = setup()
  const r = await call('/api/project/' + 'a'.repeat(24) + '?x=1', { headers: { authorization: 'Bearer t', cookie: 'c=1', 'x-evil': '1', accept: 'application/json' } })
  assert.equal(r.status, 200)
  assert.equal(calls[0].url, 'https://control.cosyhome.com.cn/v1/project/' + 'a'.repeat(24) + '?x=1')
  assert.deepEqual([...calls[0].init.headers.keys()].sort(), ['accept', 'authorization'])
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(r.headers.get('set-cookie'), null)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
})

test('ctrl pass-through: only query message_types, POST only, body ≤ 4096', async () => {
  const { call, calls } = setup()
  for (const mt of [41, 40, 44, 43, 30, 15, 6]) assert.equal((await call('/api/ctrl-message/pass', post({ message_type: mt }))).status, 200, String(mt))
  assert.equal(calls.length, 7)
  for (const body of [{ message_type: 9 }, { message_type: '9' }, {}, 'not json', { message_type: 41, pad: 'x'.repeat(5000) }]) {
    assert.equal((await call('/api/ctrl-callback-result', post(body))).status, 403)
  }
  assert.equal((await call('/api/ctrl-message/pass')).status, 404) // GET
  assert.equal(calls.length, 7)
  assert.equal(calls[0].init.headers.get('authorization'), 'Bearer t')
})

test('/geo-shared: 503 unconfigured, 413 over 2048, forwards only authorization/content-type', async () => {
  assert.equal((await setup().call('/geo-shared')).status, 503)
  const { call, calls } = setup({ GEO_FC_URL: 'https://geo.example/' })
  assert.equal((await call('/geo-shared', post('x'.repeat(2049)))).status, 413)
  assert.equal(calls.length, 0)
  const r = await call('/geo-shared', { headers: { authorization: 'Bearer t', cookie: 'c', 'if-none-match': 'e' } })
  assert.equal(calls[0].url, 'https://geo.example/geo')
  assert.deepEqual([...calls[0].init.headers.keys()].sort(), ['authorization'])
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal((await call('/geo-shared', { method: 'DELETE' })).status, 404)
})

test('static: /assets/* long cache; missing asset 404; HTML no-cache', async () => {
  const { call } = setup()
  assert.equal((await call('/assets/missing.js')).status, 404) // fake ASSETS returns html → 404
  assert.equal((await call('/')).headers.get('cache-control'), 'no-cache')
  assert.equal((await call('/favicon.ico')).status, 404)
  assert.equal((await call('/x', { method: 'POST' })).status, 404)
})

test('FC adapter: event → core → compressed response', async () => {
  const { build } = await import('esbuild')
  const dir = mkdtempSync(join(tmpdir(), 'webfc-'))
  mkdirSync(join(dir, 'pub/assets'), { recursive: true })
  writeFileSync(join(dir, 'pub/index.html'), '<html>' + 'x'.repeat(3000) + '</html>')
  writeFileSync(join(dir, 'pub/assets/a-123.js'), 'console.log(1);'.repeat(200))
  // 预压缩产物：构建期生成，运行时直接用（内容特意和原文不同，确认用的是它）
  writeFileSync(join(dir, 'pub/assets/a-123.js.br'), 'PRECOMPRESSED')
  await build({ entryPoints: [new URL('../functions/web/entry.js', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: join(dir, 'out.cjs'), logLevel: 'silent' })
  process.env.PUBLIC_DIR = join(dir, 'pub')
  const { handleEvent } = createRequire(import.meta.url)(join(dir, 'out.cjs'))
  const ev = (path, over = {}) => JSON.stringify({ rawPath: path, rawQueryString: '', headers: { host: 'h', 'accept-encoding': 'br, gzip' }, requestContext: { http: { method: 'GET' } }, ...over })
  let r = await handleEvent(Buffer.from(ev('/')))
  assert.equal(r.statusCode, 200)
  assert.equal(r.headers['cache-control'], 'no-cache')
  assert.equal(r.headers['content-encoding'], 'br')
  assert.equal(r.headers['x-frame-options'], 'DENY')
  assert.equal(r.isBase64Encoded, true)
  r = await handleEvent(Buffer.from(ev('/assets/a-123.js')))
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable')
  assert.equal(r.headers['content-encoding'], 'br')
  assert.equal(Buffer.from(r.body, 'base64').toString(), 'PRECOMPRESSED') // 预压缩，不走同步压缩
  // 地图轮廓走 OSS 同源转发
  const realFetch = globalThis.fetch
  let mapHits = 0
  globalThis.fetch = async (url) => {
    mapHits++
    if (String(url).endsWith('/map/city/320200.json')) return new Response('{"type":"FeatureCollection"}', { status: 200 })
    return new Response('nope', { status: 404 })
  }
  r = await handleEvent(Buffer.from(ev('/map/city/320200.json', { headers: { host: 'h' } })))
  assert.equal(r.statusCode, 200)
  assert.match(r.body, /FeatureCollection/)
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8')
  await handleEvent(Buffer.from(ev('/map/city/320200.json', { headers: { host: 'h' } })))
  assert.equal(mapHits, 1) // 实例内缓存
  r = await handleEvent(Buffer.from(ev('/map/city/999999.json', { headers: { host: 'h' } })))
  assert.equal(r.statusCode, 404)
  r = await handleEvent(Buffer.from(ev('/map/city/../../etc', { headers: { host: 'h' } })))
  assert.notEqual(r.statusCode, 502)
  globalThis.fetch = realFetch
  r = await handleEvent(Buffer.from(ev('/assets/nope.js')))
  assert.equal(r.statusCode, 404)
  r = await handleEvent(Buffer.from(ev('/some/route', { headers: { host: 'h' } }))) // SPA fallback, no encoding requested
  assert.equal(r.statusCode, 200)
  assert.match(r.body, /^<html>/)
  // FC 3.0 真实事件格式：查询参数在 queryParameters（已解码），不是 rawQueryString
  const realFetch2 = globalThis.fetch
  let amapUrl = ''
  globalThis.fetch = async (url) => { amapUrl = String(url); return new Response('{"status":"1"}', { status: 200, headers: { 'content-type': 'text/plain' } }) }
  process.env.AMAP_JSCODE = 'jsc'
  const real = (rawPath, queryParameters) => JSON.stringify({ version: 'v1', rawPath, headers: { host: 'x.fcapp.run' }, queryParameters, body: '', isBase64Encoded: false, requestContext: { accountId: '1', domainName: 'x', requestId: 'r', time: 't', timeEpoch: '1', http: { method: 'GET', path: rawPath, protocol: 'HTTP/1.1', sourceIp: '1.1.1.1', userAgent: 'u' } } })
  r = await handleEvent(Buffer.from(real('/_AMapService/v3/ip', { key: 'K值', callback: 'cb' })))
  const q2 = new URL(amapUrl).searchParams
  assert.equal(q2.get('key'), 'K值')
  assert.equal(q2.get('callback'), 'cb')
  assert.equal(q2.get('jscode'), 'jsc')
  assert.equal(r.headers['content-type'], 'application/javascript; charset=utf-8')
  r = await handleEvent(Buffer.from(real('/_AMapService/v3/ip', { a: ['1', '2'] })))
  assert.deepEqual(new URL(amapUrl).searchParams.getAll('a'), ['1', '2'])
  globalThis.fetch = realFetch2
  delete process.env.AMAP_JSCODE
  r = await handleEvent(Buffer.from(ev('/api/users')))
  assert.equal(r.statusCode, 404)
  r = await handleEvent(Buffer.from(ev('/api/ctrl-message/pass', { requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ message_type: 9 }), headers: { host: 'h', 'content-type': 'application/json' } })))
  assert.equal(r.statusCode, 403)
})
