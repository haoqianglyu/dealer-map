// 详情页的内存缓存（只活在当前标签页）：先用缓存秒开，过期了再后台取新值。
// 按登录会话 sid 隔离（续期不变，重新登录才变）；请求发出时记下 sid，写回时对不上就丢弃。
import { session } from './session'

const store = new Map() // key → { value, at }（Map 的插入顺序 = 最久未用在前）
const inflight = new Map()
// 容量上限：配置对象大，只留最近 30 个；项目实体最多全部项目；其余（me、设备类别）固定几个
const CAPS = { config: 30, project: 1500, _: 60 }
const capOf = (key) => CAPS[String(key).split(':')[0]] ?? CAPS._
function evict(key) {
  const prefix = String(key).split(':')[0]
  const cap = capOf(key)
  let n = 0
  for (const k of store.keys()) if (String(k).split(':')[0] === prefix) n++
  for (const k of store.keys()) {
    if (n <= cap) break
    if (String(k).split(':')[0] === prefix) {
      store.delete(k)
      n--
    }
  }
}
let owner = ''
const scope = () => session.sid() || ''
function sync() {
  const s = scope()
  if (s !== owner) {
    store.clear()
    inflight.clear()
    owner = s
  }
}
export function put(key, value, atScope = scope()) {
  sync()
  if (atScope !== owner) return
  store.delete(key)
  store.set(key, { value, at: Date.now() })
  evict(key)
}
function revalidate(key, fn) {
  if (inflight.has(key)) return inflight.get(key)
  const s = scope()
  const p = fn()
    .then((v) => {
      if (v !== null && v !== undefined) put(key, v, s)
      return v
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}
// maxAge 内直接用缓存不发请求；过期先返回旧值，后台更新后调 onFresh(新值)
export function swr(key, fn, { maxAge = 0, onFresh } = {}) {
  sync()
  const hit = store.get(key)
  if (!hit) return revalidate(key, fn)
  // 读到的放到末尾（LRU）
  store.delete(key)
  store.set(key, hit)
  if (Date.now() - hit.at >= maxAge) {
    revalidate(key, fn)
      .then((v) => {
        if (v !== null && v !== undefined) onFresh?.(v)
      })
      .catch(() => {})
  }
  return Promise.resolve(hit.value)
}
// 地图页拉项目列表时顺手存下，点进详情页就不用再等 /project/{id}。
// 在发请求前调用，拿到按当时会话写入的函数；不存客户联系方式，缺配置 id 的行不存。
export function projectSeeder() {
  const s = scope()
  return (list) => {
    for (const p of list) {
      if (!p?.id || !(p.using_config_id || p.default_config_id)) continue
      const { customer_name, customer_phone, customer_address, ...rest } = p
      put(`project:${p.id}`, rest, s)
    }
    return list
  }
}
