#!/usr/bin/env node
// 构建期预压缩：给 public/ 下的文本资源生成 .br / .gz（q11 / gzip -9），函数启动读取，请求时不再压缩。
// 用法：node precompress.mjs <dir>
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib'
import { join, extname } from 'node:path'

const OK = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map'])
const root = process.argv[2]
if (!root) {
  console.error('usage: precompress.mjs <dir>')
  process.exit(1)
}
let n = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (OK.has(extname(name).toLowerCase())) {
      const buf = readFileSync(p)
      if (buf.length <= 1024) continue
      writeFileSync(p + '.br', brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT } }))
      writeFileSync(p + '.gz', gzipSync(buf, { level: 9 }))
      n++
    }
  }
}
walk(root)
console.log(`precompressed ${n} files`)
