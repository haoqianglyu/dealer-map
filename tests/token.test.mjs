// 续期：主动排期（假定时器）+ 401/403 被动续期（假 adapter）
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

const mem = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }
}
globalThis.localStorage = mem()
globalThis.sessionStorage = mem()
let reloads = 0
globalThis.location = { hash: '#/dealer-map', reload: () => reloads++ }

const { createTokenScheduler, leadFor } = await import('../src/api/tokenScheduler.js')
const { session } = await import('../src/api/session.js')
const { default: http, refreshSession } = await import('../src/api/http.js')
const { AxiosError } = (await import('axios')).default

const H = 3600e3
test('leadFor：2 h → 5 分钟，120 s → 30 s', () => {
  assert.equal(leadFor(2 * H), 5 * 60e3)
  assert.equal(leadFor(120e3), 30e3)
})

function fakeSession(start) {
  const s = { tok: 'a', time: start, exp: start + 2 * H }
  return { s, token: () => s.tok, tokenTime: () => s.time, expiresAt: () => s.exp }
}

test('主动续期：到期前 5 分钟续，续完按新过期时间重排；失败 1 分钟后重试', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  try {
    const fs = fakeSession(0)
    let calls = 0
    let fail = false
    const sch = createTokenScheduler({
      session: fs,
      refresh: async () => {
        calls++
        if (fail) throw new Error('net')
        fs.s.time = Date.now()
        fs.s.exp = Date.now() + 2 * H
      },
    })
    sch.start()
    mock.timers.tick(2 * H - 5 * 60e3 - 1)
    assert.equal(calls, 0)
    mock.timers.tick(1)
    await Promise.resolve(); await Promise.resolve()
    assert.equal(calls, 1)
    assert.ok(sch.pending())
    // 下一次：新 exp − 5 min
    fail = true
    mock.timers.tick(2 * H - 5 * 60e3)
    await Promise.resolve(); await Promise.resolve()
    assert.equal(calls, 2)
    fail = false
    mock.timers.tick(60e3)
    await Promise.resolve(); await Promise.resolve()
    assert.equal(calls, 3)
    sch.stop()
  } finally {
    mock.timers.reset()
  }
})

test('主动续期：标签页重新可见时已过期 → 立即续；未到点 → 不续', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  try {
    const fs = fakeSession(0)
    let calls = 0
    const sch = createTokenScheduler({ session: fs, refresh: async () => { calls++; fs.s.time = Date.now(); fs.s.exp = Date.now() + 2 * H } })
    sch.start()
    sch.onVisible()
    await Promise.resolve()
    assert.equal(calls, 0)
    // 模拟睡眠：时钟跳过过期时刻但定时器没跑
    mock.timers.setTime(3 * H)
    sch.onVisible()
    await Promise.resolve(); await Promise.resolve()
    assert.equal(calls, 1)
    sch.stop()
  } finally {
    mock.timers.reset()
  }
})

// ---- 被动续期 ----
let refreshCalls = []
let handler
http.defaults.adapter = async (config) => {
  const auth = config.headers?.Authorization || config.headers?.get?.('Authorization')
  const res = await handler(config, auth, config.data ? JSON.parse(config.data) : null)
  const response = { data: res.data ?? {}, status: res.status, statusText: '', headers: {}, config }
  if (res.status >= 400) throw new AxiosError('fail', 'ERR_BAD_REQUEST', config, null, response)
  return response
}
const platform = ({ forbidAlways = false, refreshOk = true } = {}) => {
  let cur = 'T1'
  let rt = 'R1'
  return (config, auth, body) => {
    if (config.url === '/auth/refresh') {
      refreshCalls.push({ auth, body })
      if (!refreshOk || body?.refresh_token !== rt || !auth) return { status: 401, data: { code: 16 } }
      cur = cur.replace(/\d+/, (n) => +n + 1)
      rt = rt.replace(/\d+/, (n) => +n + 1)
      return { status: 200, data: { access_token: cur, refresh_token: rt, expires_in: 7200 } }
    }
    if (config.url === '/ctrl-message/pass') return { status: 403, data: { error: 'message_type not allowed' } }
    // 过期 token：告警接口回 403（平台实际行为）
    if (auth !== `Bearer ${cur}`) return { status: 403, data: { message: 'token expired' } }
    if (forbidAlways) return { status: 403, data: {} }
    return { status: 200, data: { ok: true, auth } }
  }
}
const reset = (opts) => {
  localStorage.clear()
  session.save({ access_token: 'T0', refresh_token: 'R1', expires_in: 7200 }) // T0 已在服务器端过期
  refreshCalls = []
  reloads = 0
  handler = platform(opts)
}

test('过期 token 在告警接口上返回 403 → 续期（带旧 access_token 头 + refresh_token）→ 重试成功', async () => {
  reset()
  const r = await http.post('/device-alarms', {})
  assert.equal(r.data.auth, 'Bearer T2')
  assert.equal(refreshCalls.length, 1)
  assert.equal(refreshCalls[0].auth, 'Bearer T0')
  assert.deepEqual(refreshCalls[0].body, { refresh_token: 'R1' })
  assert.equal(session.token(), 'T2')
  assert.equal(session.refreshToken(), 'R2')
  assert.equal(localStorage.getItem('dm_token'), 'T2') // 存 localStorage
})

test('并发 3 个请求同时 401/403 → 只续期一次（refresh_token 一次性）', async () => {
  reset()
  const rs = await Promise.all([http.post('/device-alarms', {}), http.get('/me'), http.post('/projects', {})])
  assert.equal(refreshCalls.length, 1)
  assert.ok(rs.every((r) => r.data.auth === 'Bearer T2'))
})

test('续期失败 → 清会话回登录页', async () => {
  reset({ refreshOk: false })
  http.post('/device-alarms', {}) // 永不 resolve（页面重载）
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(reloads, 1)
  assert.equal(session.token(), null)
  assert.equal(sessionStorage.getItem('dm_login_reason'), '登录已过期，请重新登录')
})

test('续期后重试仍 403 → 交给页面（无权限）；同一 token 下次轮询不再续期', async () => {
  reset({ forbidAlways: true })
  await assert.rejects(http.post('/device-alarms', {}), (e) => e.response.status === 403)
  assert.equal(refreshCalls.length, 1)
  await assert.rejects(http.post('/device-alarms', {}), (e) => e.response.status === 403)
  assert.equal(refreshCalls.length, 1)
  assert.equal(reloads, 0)
})

test('Worker 拒绝的 message_type（403）不触发续期', async () => {
  reset()
  await assert.rejects(http.post('/ctrl-message/pass', {}), (e) => e.response.status === 403)
  assert.equal(refreshCalls.length, 0)
})

test('主动续期 refreshSession：token 已被别的标签页换过 → 不再拿旧 refresh_token 去换', async () => {
  reset()
  const seen = session.token()
  localStorage.setItem('dm_token', 'OTHER')
  await refreshSession({ ifToken: seen })
  assert.equal(refreshCalls.length, 0)
})

test('退出清除 localStorage 里的会话', () => {
  reset()
  session.clear()
  assert.equal(localStorage.getItem('dm_token'), null)
  assert.equal(localStorage.getItem('dm_refresh_token'), null)
})

test('续期进行中退出 → 续期结果被丢弃，不恢复会话', async () => {
  reset()
  const base = handler
  let release
  handler = async (config, auth, body) => {
    if (config.url === '/auth/refresh') await new Promise((r) => (release = r))
    return base(config, auth, body)
  }
  const p = refreshSession()
  await new Promise((r) => setTimeout(r, 5))
  session.clear()
  release()
  await p
  assert.equal(session.token(), null)
})

test('登录生成新 sid，续期保持 sid 不变', async () => {
  reset()
  session.save({ access_token: 'T1', refresh_token: 'R1', expires_in: 7200 }, { newLogin: true })
  const sid = session.sid()
  await refreshSession()
  assert.equal(session.token(), 'T2')
  assert.equal(session.sid(), sid)
})
