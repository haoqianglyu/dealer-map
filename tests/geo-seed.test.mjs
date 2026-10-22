import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createSeedHandler } from '../worker/seed.js'

const seed = { _readme: 'x', '320211|无锡市某某苑': { p: [120.1, 31.5], n: '某某苑' } }
const overrides = { '无锡市滨湖区某某小区': [120.2, 31.6] }
const TOKEN = 'Bearer abcdefghijklmnop'

function setup(meStatus = 200) {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push([url, init.headers.authorization])
    return new Response('{}', { status: init.headers.authorization === TOKEN ? meStatus : 401 })
  }
  let t = 0
  const h = createSeedHandler({ seed, overrides, apiOrigin: 'https://p/v1', fetchFn, now: () => t })
  return { h, calls, tick: (ms) => (t += ms) }
}
const req = (auth, method = 'GET') => new Request('https://x/geo-shared/seed', { method, headers: auth ? { authorization: auth } : {} })

test('seed: no / malformed token → 401 without calling platform', async () => {
  const { h, calls } = setup()
  for (const a of [null, 'Bearer short', 'Basic abcdefghijklmnop']) {
    const r = await h(req(a))
    assert.equal(r.status, 401)
    assert.equal(r.headers.get('cache-control'), 'no-store')
  }
  assert.equal(calls.length, 0)
})

test('seed: invalid token (platform /me not 200) → 401', async () => {
  const { h, calls } = setup()
  const r = await h(req('Bearer zzzzzzzzzzzzzzzz'))
  assert.equal(r.status, 401)
  assert.deepEqual(calls[0], ['https://p/v1/me', 'Bearer zzzzzzzzzzzzzzzz'])
})

test('seed: valid token → 200 private JSON {seed, overrides}; auth cached 10 min', async () => {
  const { h, calls, tick } = setup()
  const r = await h(req(TOKEN))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'private, max-age=3600')
  assert.deepEqual(await r.json(), { seed, overrides })
  await h(req(TOKEN))
  assert.equal(calls.length, 1)
  tick(11 * 60 * 1000)
  await h(req(TOKEN))
  assert.equal(calls.length, 2)
})

test('seed: platform unreachable → 503; POST → 405', async () => {
  const h = createSeedHandler({ seed, overrides, apiOrigin: 'https://p/v1', fetchFn: async () => { throw new Error('down') } })
  assert.equal((await h(req(TOKEN))).status, 503)
  assert.equal((await h(req(TOKEN, 'POST'))).status, 405)
})

test('seed files are not public static assets', () => {
  assert.ok(!existsSync(new URL('../public/geo-seed.json', import.meta.url)))
  assert.ok(!existsSync(new URL('../public/geo-overrides.json', import.meta.url)))
  const s = JSON.parse(readFileSync(new URL('../worker/data/geo-seed.json', import.meta.url), 'utf8'))
  assert.match(s._readme, /worker\/data\/geo-seed\.json/)
})
