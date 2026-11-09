// deploy 工具函数：fc_check 只有明确 404 才返回「不存在」；smoke_check 三项都过才算成功
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

const lib = new URL('../functions/web/lib.sh', import.meta.url).pathname
function runBash(script, env = {}) {
  return spawnSync('bash', ['-c', `set -uo pipefail; source "${lib}"; ${script}`], { encoding: 'utf8', env: { ...process.env, ...env } })
}
function stubAliyun(body, code) {
  const dir = mkdtempSync(join(tmpdir(), 'alistub-'))
  const bin = join(dir, 'aliyun')
  writeFileSync(bin, `#!/bin/sh\necho '${body}'\nexit ${code}\n`)
  chmodSync(bin, 0o755)
  return { PATH: `${dir}:${process.env.PATH}` }
}

test('fc_check：存在 0；明确 404 → 1；其它错误 → 2，不当成不存在', () => {
  assert.equal(runBash('fc_check /f', stubAliyun('ok', 0)).status, 0)
  assert.equal(runBash('fc_check /f', stubAliyun('ErrorCode: FunctionNotFound', 1)).status, 1)
  assert.equal(runBash('fc_check /f', stubAliyun('HTTP Status: 404 not here', 1)).status, 1)
  const e = runBash('fc_check /f', stubAliyun('Forbidden', 1))
  assert.equal(e.status, 2)
  assert.match(e.stderr, /fc query failed/)
})

test('smoke_check：页面 200 含 app、/api/me 401、高德代理正常 → 通过；缺一项失败', async () => {
  let meStatus = 401
  let amapBody = '{"status":"1"}'
  const srv = createServer((req, res) => {
    if (req.url === '/') return res.end('<div id="app"></div>')
    if (req.url.startsWith('/api/me')) {
      res.statusCode = meStatus
      return res.end('')
    }
    if (req.url.startsWith('/_AMapService')) return res.end(amapBody)
    res.statusCode = 404
    res.end()
  })
  await new Promise((r) => srv.listen(0, r))
  const url = `http://127.0.0.1:${srv.address().port}`
  try {
    const go = async () => {
      const { spawn } = await import('node:child_process')
      return new Promise((resolve) => {
        const c = spawn('bash', ['-c', `set -uo pipefail; source "${lib}"; smoke_check "${url}"`], { env: { ...process.env, SMOKE_AMAP_KEY: 'k' } })
        c.on('close', (code) => resolve(code))
      })
    }
    assert.equal(await go(), 0)
    meStatus = 200
    assert.equal(await go(), 1)
    meStatus = 403
    amapBody = '{"status":"0","info":"INVALID"}'
    assert.equal(await go(), 1)
  } finally {
    srv.close()
  }
})

test('promote：候选通过后切别名；线上复验失败自动指回旧版本', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alistub2-'))
  const log = join(dir, 'log')
  writeFileSync(join(dir, 'aliyun'), `#!/bin/sh\necho "$*" >> ${log}\necho '{"versionId":"7"}'\n`)
  chmodSync(join(dir, 'aliyun'), 0o755)
  let body = '<div id="app"></div>'
  const srv = createServer((req, res) => {
    if (req.url === '/') return res.end(body)
    if (req.url.startsWith('/api/me')) { res.statusCode = 401; return res.end('') }
    res.end('{"status":"1"}')
  })
  await new Promise((r) => srv.listen(0, r))
  const url = `http://127.0.0.1:${srv.address().port}`
  const { spawn } = await import('node:child_process')
  const run = () => new Promise((resolve) => {
    const c = spawn('bash', ['-c', `set -uo pipefail; source "${lib}"; promote /fn prod 9 8 "${url}"`], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SMOKE_AMAP_KEY: 'k', SMOKE_INTERVAL: '0' } })
    c.on('close', resolve)
  })
  const { readFileSync, rmSync } = await import('node:fs')
  try {
    assert.equal(await run(), 0)
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map((l) => l.match(/versionId":"(\d+)/)[1]), ['9'])
    rmSync(log)
    body = 'broken'
    assert.equal(await run(), 1)
    // 切到 9，复验失败后指回 8
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map((l) => l.match(/versionId":"(\d+)/)[1]), ['9', '8'])
  } finally {
    srv.close()
  }
})
