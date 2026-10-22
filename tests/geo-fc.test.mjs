import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { validate } = createRequire(import.meta.url)('../functions/geo/index.js')._test

const body = (key) => ({ key, adcode: '320211', lng: 120.27, lat: 31.53 })
test('FC key check: 元 / 室 alone are not unit addresses', () => {
  for (const k of ['无锡市滨湖区天元世家', '无锡市滨湖区单元花园', '无锡市滨湖区兰室雅居', '无锡市滨湖区层林苑']) assert.equal(typeof validate(body(k)), 'object', k)
})
test('FC key check: numbered 栋/单元/室 and # are rejected', () => {
  for (const k of ['无锡市滨湖区某某苑三栋', '无锡市滨湖区某某苑二单元', '无锡市滨湖区某某苑A幢', '无锡市滨湖区某某苑十二室', '无锡市滨湖区某某苑#', '无锡市滨湖区某某苑五号楼']) assert.equal(validate(body(k)), 'key looks like a unit address', k)
  assert.equal(validate(body('无锡市滨湖区某某苑3栋')), 'key must not contain digits')
})
test('FC key check: 天干 / full-width / direction unit tokens are rejected (NFKC first)', () => {
  assert.equal(typeof validate(body('无锡市滨湖区天元世家')), 'object')
  for (const k of ['无锡市滨湖区某某花园甲幢', '无锡市滨湖区某某花园乙栋', '无锡市滨湖区某某花园Ａ栋', '无锡市滨湖区某某花园Ａ栋Ｂ单元', '无锡市滨湖区某某花园２０２室', '无锡市滨湖区某某花园3栋2单元', '无锡市滨湖区某某花园东栋', '无锡市滨湖区某某花园西 幢', '无锡市滨湖区某某花园＃', '无锡市滨湖区某某花园Ⅲ栋', '无锡市滨湖区某某花园①']) {
    assert.equal(typeof validate(body(k)), 'string', k)
  }
  assert.equal(validate(body('无锡市滨湖区某某花园２０２室')), 'key must not contain digits')
  assert.equal(validate(body('无锡市滨湖区某某花园甲幢')), 'key looks like a unit address')
  assert.equal(validate(body('无锡市滨湖区某某花园Ａ栋')), 'key looks like a unit address')
})
