import test from 'node:test'
import assert from 'node:assert/strict'
import { isFacility, pickPoi, spreadKm, groupFp, isSameName } from '../src/geo/geocoder.js'
import { parseShared, mergeShared } from '../src/geo/shared.js'
import { buildGroups } from '../src/geo/groups.js'
import { createRequire } from 'node:module'
const { validateFail, applyEntry, pruneFails } = createRequire(import.meta.url)('../functions/geo/index.js')._test

const G = { districtName: '滨湖区', cityName: '无锡市', district: '320211', city: '320200' }
const poi = (name, lng = 120.27, lat = 31.53, adcode = '320211', extra = {}) => ({ name, location: [lng, lat], adcode, ...extra })

test('附属设施：售楼处、停车场、门、地铁站；小区名自带关键词不算', () => {
  for (const c of ['示例花园售楼处', '示例花园(东门)', '示例花园(东2门)', '示例花园西北门', '示例花园地下停车场', '示例花园地铁站', '示例花园(出入口)', '示例花园(公交站)', '示例花园营销中心', '示例花园物业服务中心']) {
    assert.equal(isFacility('示例花园', c), true, c)
  }
  for (const [n, c] of [['示例花园', '示例花园'], ['示例花园', '示例花园东区'], ['龙门花园', '龙门花园'], ['公交新村', '公交新村'], ['示例花园', '示例花园小区']]) {
    assert.equal(isFacility(n, c), false, `${n}/${c}`)
  }
  assert.equal(isFacility('示例花园', '示例花园', '交通设施服务;停车场;公共停车场'), true)
})

test('完全同名优先于排在前面的售楼处', () => {
  const r = pickPoi('示例花园', [poi('示例花园售楼处'), poi('示例花园'), poi('示例花园(东门)')], G)
  assert.equal(r.hit.name, '示例花园')
})

test('带分期的完全同名也优先', () => {
  assert.equal(isSameName('江南府三期', '江南府三期'), true)
  const r = pickPoi('江南府三期', [poi('江南府三期售楼处'), poi('江南府三期')], G)
  assert.equal(r.hit.name, '江南府三期')
})

test('只有附属设施 → 不确认，并标 facilityOnly', () => {
  const r = pickPoi('示例花园', [poi('示例花园售楼处'), poi('示例花园停车场')], G)
  assert.equal(r.hit, undefined)
  assert.equal(r.facilityOnly, true)
})

test('包含匹配的候选相距 > 3 km → 待校正，不凭首项确认', () => {
  const r = pickPoi('示例花园', [poi('示例花园景城', 120.27, 31.53), poi('示例花园雅居', 120.32, 31.53)], G)
  assert.equal(r.hit, undefined)
  assert.equal(r.why, '多个候选相距较远')
  assert.equal(pickPoi('示例花园', [poi('示例花园景城', 120.27, 31.53), poi('示例花园雅居', 120.271, 31.531)], G).hit.name, '示例花园景城')
  assert.ok(spreadKm([[120.27, 31.53], [120.32, 31.53]]) > 4)
})

test('项目没写分期且区内有多个分期 → 不明确；有完全同名主条目时仍取主条目', () => {
  assert.equal(pickPoi('江南府', [poi('江南府三期'), poi('江南府二期')], G).why, '分期/分区不一致或不明确')
  assert.equal(pickPoi('江南府', [poi('江南府三期'), poi('江南府')], G).hit.name, '江南府')
})

test('区外候选不参与', () => {
  assert.equal(pickPoi('示例花园', [poi('示例花园', 120.27, 31.53, '320205')], G).hit, undefined)
})

test('分组：同组候选合并，与项目顺序无关', () => {
  const a = { id: 'a', community: '示例花园', geoDistrict: '320211', city: '320200', district: '320211', queries: ['无锡市滨湖区示例花园'], keywords: ['示例花园'], area: 1, type: 'x', created: '' }
  const b = { id: 'b', community: '示例花园', geoDistrict: '320211', city: '320200', district: '320211', queries: ['无锡市滨湖区示例花园', '无锡市滨湖区地址另一名'], keywords: ['示例花园', '地址另一名'], area: 1, type: 'x', created: '' }
  const [g1] = buildGroups([a, b])
  const [g2] = buildGroups([b, a])
  assert.deepEqual(g1.queries, g2.queries)
  assert.deepEqual(g1.keywords, g2.keywords)
  assert.equal(g1.queries.length, 2)
  assert.equal(g1.queries[0], '无锡市滨湖区示例花园')
  assert.equal(groupFp(g1), groupFp(g2))
  assert.notEqual(groupFp(g1), groupFp({ queries: ['无锡市滨湖区示例花园'] }))
})

test('共享：失败结果带过期，不盖掉已有坐标', () => {
  const now = 1000
  const parsed = parseShared({ points: { 'a|q': { lng: 120, lat: 31, matched_name: 'n' } }, fails: { 'b|q': { r: '未找到', fp: 'r2:x', exp: 2000 }, 'c|q': { r: '未找到', fp: 'r2:x', exp: 500 } } }, now)
  assert.deepEqual(Object.keys(parsed).sort(), ['a|q', 'b|q'])
  const merged = mergeShared({ 'b|q': { p: [1, 2] }, 'd|q': [3, 4] }, { 'b|q': { f: '未找到', shared: true }, 'd|q': { f: '未找到', shared: true }, 'e|q': { f: '未找到', shared: true } })
  assert.deepEqual(merged['b|q'], { p: [1, 2] })
  assert.deepEqual(merged['d|q'], [3, 4])
  assert.equal(merged['e|q'].f, '未找到')
})

test('FC 失败结果：白名单原因、7 天过期，临时错误进不来，已有坐标不写，坐标到了清失败', () => {
  const base = { key: '无锡市滨湖区示例花园', adcode: '320211', fp: 'r2:ab12' }
  assert.equal(validateFail({ ...base, reason: '高德返回错误 TIMEOUT' }), 'reason not allowed')
  assert.equal(validateFail({ ...base, reason: '未找到（高德临时错误，下次加载重试）' }), 'reason not allowed')
  assert.equal(validateFail({ ...base, reason: '本轮搜索配额已用完' }), 'reason not allowed')
  assert.equal(validateFail({ ...base, key: '无锡市滨湖区某苑3栋', reason: '未找到' }), 'key must not contain digits')
  const v = validateFail({ ...base, reason: '未找到' }, 1000)
  assert.equal(v.f.exp, 1000 + 7 * 86400000)
  const doc = { points: {}, fails: {} }
  const next = applyEntry(doc, v, 1000)
  assert.equal(next.fails[v.id].r, '未找到')
  // 一天内同样的上报不重复写
  assert.equal(applyEntry(next, v, 2000), null)
  // 已有坐标时不写失败
  assert.equal(applyEntry({ points: { [v.id]: { lng: 1, lat: 2 } }, fails: {} }, v, 1000), null)
  // 坐标到了：失败被清掉
  const withPoint = applyEntry(next, { id: v.id, p: { lng: 1, lat: 2, matched_name: '' } }, 3000)
  assert.equal(withPoint.fails[v.id], undefined)
  assert.equal(withPoint.points[v.id].lng, 1)
  assert.deepEqual(pruneFails({ x: { exp: 500 }, y: { exp: 5000 } }, 1000), { y: { exp: 5000 } })
})

test('定位结果：临时失败退避、到期判断、项目元数据比对', async () => {
  const { retryBackoff, stamp, expired, syncProjects, POS_TTL, FAIL_TTL } = await import('../src/geo/resultLife.js')
  assert.deepEqual([1, 2, 3, 9].map((n) => retryBackoff(n) / 60000), [5, 15, 45, 360])
  assert.equal(stamp({ lnglat: [1, 2] }, { now: 100 }).exp, 100 + POS_TTL)
  assert.equal(stamp({ fail: true }, { now: 100 }).exp, 100 + FAIL_TTL)
  assert.equal(stamp({ fail: true, transient: true }, { now: 100, attempts: 2 }).exp, 100 + 15 * 60000)
  assert.equal(expired({ exp: 100 }, 99), false)
  assert.equal(expired({ exp: 100 }, 100), true)
  const a = { id: '1', name: 'x1', community: 'x', geoDistrict: 'd', city: 'c', queries: ['q'], keywords: ['x'], area: 1 }
  const b = { id: '2', name: 'y', community: 'y', geoDistrict: 'd', city: 'c', queries: ['y'], keywords: ['y'], area: 1 }
  // 没变：沿用旧数组
  const same = syncProjects([a, b], [{ ...a }, { ...b }])
  assert.equal(same.changed, false)
  assert.equal(same.list[0], a)
  // 只改面积：替换项目，不失效定位
  const area = syncProjects([a], [{ ...a, area: 9 }])
  assert.equal(area.changed, true)
  assert.deepEqual(area.invalidKeys, [])
  // 改名：小区名变 → 新旧分组都失效
  const renamed = syncProjects([a], [{ ...a, community: 'z', queries: ['zq'], keywords: ['z'] }])
  assert.deepEqual(renamed.invalidKeys.sort(), ['d|x', 'd|z'])
})

test('在途共享 / 按 id 加载 / 最新令牌', async () => {
  const { createSharedFetch, createIdLoader } = await import('../src/utils/sharedFetch.js')
  const { createLatest } = await import('../src/utils/latest.js')
  let calls = 0
  let t = 0
  const f = createSharedFetch(async () => ++calls, { ttl: 1000, now: () => t })
  const [a, b] = await Promise.all([f.get(), f.get()])
  assert.deepEqual([a, b, calls], [1, 1, 1])
  t = 500
  assert.equal(await f.get(), 1)
  assert.equal(await f.get({ maxAge: 0 }), 2)
  const err = createSharedFetch(async () => { throw new Error('x') }, { ttl: 1000 })
  await assert.rejects(err.get())
  let scope = 'a'
  const sc = createSharedFetch(async () => scope, { ttl: 99999, scope: () => scope })
  assert.equal(await sc.get(), 'a')
  scope = 'b'
  assert.equal(await sc.get(), 'b')
  // id 加载：并发上限 + 去重，失败才可重试
  const seen = []
  let running = 0
  let peak = 0
  let n = 0
  const load = createIdLoader(async (id) => {
    seen.push(id)
    peak = Math.max(peak, ++running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    if (id === 'bad') throw new Error('no')
    return id
  }, { concurrency: 2, retryAfter: 1000, now: () => n })
  load.want(['a', 'b', 'c', 'bad'])
  load.want(['a', 'b'])
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(seen.sort(), ['a', 'b', 'bad', 'c'])
  assert.ok(peak <= 2)
  load.want(['bad'])
  assert.equal(seen.length, 4)
  n = 2000
  load.want(['bad'])
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(seen.length, 5)
  const l = createLatest()
  const first = l.begin()
  const second = l.begin()
  assert.equal(first.stale(), true)
  assert.equal(second.stale(), false)
  assert.equal(first.signal.aborted, true)
})

test('worker 上游：带截止时间，异常转 502/504', async () => {
  const { createApp } = await import('../worker/core.js')
  const assets = { fetch: async () => new Response('x') }
  const app = (fetchFn) => createApp({ seed: {}, overrides: {}, fetchFn })
  let init
  await app(async (u, i) => { init = i; return new Response('{}') }).fetch(new Request('https://x/api/me'), { ASSETS: assets })
  assert.ok(init.signal instanceof AbortSignal)
  const res = await app(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e }).fetch(new Request('https://x/api/me'), { ASSETS: assets })
  assert.equal(res.status, 504)
  assert.deepEqual(await res.json(), { error: 'upstream timeout' })
  const res2 = await app(async () => { throw new Error('dns') }).fetch(new Request('https://x/api/me'), { ASSETS: assets })
  assert.equal(res2.status, 502)
})

test('详情页状态：失败不说无告警 / 离线；加载中单独', async () => {
  const { alarmDisplay, onlineStateOf, liveFailText, ONLINE_LABEL } = await import('../src/utils/detailStatus.js')
  assert.equal(alarmDisplay(false, { alarms: [], okAt: 0, staleSince: 0, error: '' }).state, 'loading')
  assert.equal(alarmDisplay(true, { alarms: [], okAt: 0, staleSince: 1, error: 'failed' }).state, 'error')
  assert.notEqual(alarmDisplay(true, { alarms: [], okAt: 0, staleSince: 1, error: 'failed' }).text, '10 天内无一级告警')
  assert.equal(alarmDisplay(true, { alarms: [], okAt: 5, staleSince: 0, error: '' }).state, 'empty')
  assert.equal(alarmDisplay(true, { alarms: [{}], okAt: 5, staleSince: 6, error: '' }).state, 'stale')
  assert.equal(alarmDisplay(true, { alarms: [], okAt: 0, staleSince: 0, error: 'forbidden' }).text, '无告警查看权限')
  assert.equal(onlineStateOf('loading', false, false), 'querying')
  assert.equal(onlineStateOf('error', false, false), 'unknown')
  assert.equal(onlineStateOf('timeout', false, false), 'unknown')
  assert.equal(onlineStateOf('ok', true, true), 'on')
  assert.equal(onlineStateOf('ok', true, false), 'off')
  assert.equal(ONLINE_LABEL[onlineStateOf('error', false, false)], '未知')
  assert.equal(liveFailText('timeout', 'error').text, '现场设备未响应')
  assert.equal(liveFailText('error', 'error').text, '实时查询失败')
})

test('展示模式进入详情后保持', async () => {
  const { parseShowroom } = await import('../src/utils/showroom.js')
  assert.equal(parseShowroom('?region=1&showroom=1', false), true)
  assert.equal(parseShowroom('&region=1', true), true) // 详情页 URL 没带 showroom：沿用会话
  assert.equal(parseShowroom('&showroom=0', true), false)
  assert.equal(parseShowroom('', false), false)
})

test('重载策略：入口对比、每日时段、错误阈值、防死循环、噪声', async () => {
  const { entryOf, shouldDailyReload, ymd, createErrorCounter, recoverAllowed, isNoise } = await import('../src/utils/reloadPolicy.js')
  assert.equal(entryOf('<script type="module" crossorigin src="/assets/index-AbC123_d.js"></script>'), '/assets/index-AbC123_d.js')
  assert.equal(entryOf('<html>no entry</html>'), '')
  const d = new Date(2026, 10, 9, 4, 30)
  assert.equal(shouldDailyReload(d, ''), true)
  assert.equal(shouldDailyReload(d, ymd(d)), false)
  assert.equal(shouldDailyReload(new Date(2026, 10, 9, 5), ''), false)
  let t = 0
  const c = createErrorCounter({ limit: 3, windowMs: 100, now: () => t })
  assert.equal(c.hit(), false)
  assert.equal(c.hit(), false)
  t = 500 // 窗口外的不算
  assert.equal(c.hit(), false)
  assert.equal(c.hit(), false)
  assert.equal(c.hit(), true)
  const now = 1000000000
  assert.equal(recoverAllowed([now - 1000, now - 2000], now).allowed, true)
  assert.equal(recoverAllowed([now - 1000, now - 2000, now - 3000], now).allowed, false)
  assert.equal(recoverAllowed([now - 3600000, now - 3600001, now - 3600002], now).allowed, true)
  assert.equal(isNoise(null, { message: 'Script error.' }), true)
  assert.equal(isNoise(new TypeError('x is undefined')), false)
  assert.equal(isNoise({ isAxiosError: true }), true)
  assert.equal(isNoise({ name: 'TimeoutError' }), true)
})

test('precompress：生成 br/gz，小文件跳过', async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { brotliDecompressSync } = await import('node:zlib')
  const { readFileSync } = await import('node:fs')
  const d = mkdtempSync(join(tmpdir(), 'pre-'))
  const big = 'x'.repeat(5000)
  writeFileSync(join(d, 'a.js'), big)
  writeFileSync(join(d, 'small.js'), 'y')
  writeFileSync(join(d, 'p.png'), big)
  execFileSync('node', [new URL('../functions/web/precompress.mjs', import.meta.url).pathname, d])
  assert.equal(brotliDecompressSync(readFileSync(join(d, 'a.js.br'))).toString(), big)
  assert.ok(existsSync(join(d, 'a.js.gz')))
  assert.equal(existsSync(join(d, 'small.js.br')), false)
  assert.equal(existsSync(join(d, 'p.png.br')), false)
})

test('本市前缀：旧的全市查询串和种子继续命中，不重新定位', async () => {
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 }
  const { lookupLocal } = await import('../src/geo/geocoder.js')
  const g = { district: '320211', city: '320200', cityName: '无锡市', districtName: '滨湖区', community: '示例花园', queries: ['无锡市滨湖区示例花园'], keywords: ['示例花园'], legacy: { scope: '320200', queries: ['无锡市示例花园'], keywords: ['示例花园'] } }
  const r = lookupLocal(g, {}, { '320200|无锡市示例花园': { p: [120.2, 31.5], n: '示例花园' } })
  assert.deepEqual(r.lnglat, [120.2, 31.5])
  // 旧查询串的人工校正也保留
  assert.equal(lookupLocal(g, { 无锡市示例花园: [1, 2] }, {}).source, 'override')
})

test('失败种子：候选变了放行重查（受额度），新格式看指纹和期限', async () => {
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 }
  const { lookupLocal, groupFp } = await import('../src/geo/geocoder.js')
  const { createRetryBudget } = await import('../src/geo/resultLife.js')
  const key = '无锡市滨湖区甲'
  const g = { district: '320211', city: '320200', cityName: '无锡市', districtName: '滨湖区', community: '甲', queries: [key, '无锡市滨湖区乙'], keywords: ['甲', '乙'] }
  const one = { ...g, queries: [key], keywords: ['甲'] }
  const old = { '320211|无锡市滨湖区甲': { f: '未找到', ret: null } }
  // 单候选 + 旧格式：沿用
  assert.equal(lookupLocal(one, {}, old).fail, true)
  // 多候选 + 旧格式：有额度放行（返回 null 进队列），额度用完继续认这条失败
  const b = createRetryBudget(1)
  assert.equal(lookupLocal(g, {}, old, { allowSeedRetry: b.allow }), null)
  const g2 = { ...g, queries: ['无锡市滨湖区丙', '无锡市滨湖区丁'], keywords: ['丙', '丁'] }
  const old2 = { '320211|无锡市滨湖区丙': { f: '未找到' } }
  assert.equal(lookupLocal(g2, {}, old2, { allowSeedRetry: b.allow }).fail, true) // 超出额度
  // 同一个 key 在同一轮内再次询问仍放行（不算两次）
  assert.equal(lookupLocal(g, {}, old, { allowSeedRetry: b.allow }), null)
  // 新格式：指纹一致且未过期沿用；期限过了或指纹不同放行
  const fp = groupFp(g)
  assert.equal(lookupLocal(g, {}, { '320211|无锡市滨湖区甲': { f: '未找到', fp, exp: Date.now() + 10000 } }, { allowSeedRetry: () => true }).fail, true)
  assert.equal(lookupLocal(g, {}, { '320211|无锡市滨湖区甲': { f: '未找到', fp, exp: Date.now() - 1 } }, { allowSeedRetry: () => true }), null)
  assert.equal(lookupLocal(g, {}, { '320211|无锡市滨湖区甲': { f: '未找到', fp: 'r9:zz', exp: Date.now() + 10000 } }, { allowSeedRetry: () => true }), null)
  b.reset()
  assert.equal(b.size, 0)
})
