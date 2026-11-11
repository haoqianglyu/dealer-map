import test from 'node:test'
import assert from 'node:assert/strict'
import { isExactName, matchName } from '../src/geo/geocoder.js'

test('完全同名且都不带分期：认主条目（忽略标点）', () => {
  assert.equal(isExactName('吉宝澜岸铭邸', '吉宝·澜岸铭邸'), true)
  assert.equal(matchName('吉宝澜岸铭邸', '吉宝澜岸铭邸'), 'ok')
})
test('任一方带分期、或名称不同：不算完全同名', () => {
  assert.equal(isExactName('吉宝澜岸铭邸', '吉宝澜岸铭邸-南区'), false)
  assert.equal(isExactName('吉宝澜岸铭邸', '吉宝澜岸铭邸4期'), false)
  assert.equal(isExactName('江南府三期', '江南府三期'), false)
  assert.equal(isExactName('江南府', '江南府小区'), false)
})
