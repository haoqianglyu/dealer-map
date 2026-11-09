// 设备透传查询（参照 niuniu）：POST /ctrl-message/pass 发查询 → 轮询 /ctrl-callback-result（先快后慢，最多 8 秒）→ protobuf 解码。
// 只用于查询类消息（Worker 也只放行 41/40/44/43/30/15/6）。只在用户打开项目详情页时调用。
import http from './http'

let pbP = null
const pb = () =>
  (pbP ||= import('@/vendor/ctrlcb_pb.js')
    .then((m) => m.ctrlcb.v1)
    .catch((e) => {
      pbP = null // 发版后旧 chunk 404：下次重试，不永久失败
      throw e
    }))
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })

const toB64 = (bytes) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromB64 = (b64) => Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))

export class DeviceTimeout extends Error {
  constructor() {
    super('现场设备未响应')
    this.name = 'DeviceTimeout'
  }
}

// type → [查询消息（null = body "{}"）, 回复消息]
const TYPES = {
  41: [null, 'RoomStatusGetReply'],
  40: [null, 'RoomDataGetReply'],
  44: [null, 'AmmeterDataQueryReply'],
  43: [null, 'EnergyDtoQueryReply'],
  30: ['OnlineDeviceListQuery', 'OnlineDeviceListReply'],
  15: ['DeviceDataGetQuery', 'DeviceDataGetReply'],
  6: ['StrainerDataGetQuery', 'StrainerDataGetReply'], // 滤网数据
}

export async function ctrlQuery(type, { projectId, userId, query = {}, timeout = 8000, signal } = {}) {
  const [Q, R] = TYPES[type] || []
  if (!R) throw new Error(`unsupported message_type ${type}`)
  const v1 = await pb()
  const body = Q ? toB64(v1[Q].encode(v1[Q].fromObject(query)).finish()) : '{}'
  // 总期限从发送前算起，发送和每次取结果都受它和 signal 约束
  const deadline = Date.now() + timeout
  const opts = () => ({ signal, timeout: Math.max(1, deadline - Date.now()) })
  try {
    const sent = await http.post('/ctrl-message/pass', { project_id: projectId, message_type: type, body, ...(userId ? { user_id: userId } : {}), ...(type === 30 ? { shadow_body: '' } : {}) }, opts())
    const requestId = sent.data?.request_id || sent.data?.data?.request_id
    if (!requestId) throw new DeviceTimeout()
    // 现场通常 1 秒内就回：先快后慢地问
    for (let i = 0; ; i++) {
      const left = deadline - Date.now()
      if (left <= 0) break
      await sleep(Math.min(300 + i * 200, 1500, left), signal)
      if (Date.now() >= deadline) break
      const r = await http.post('/ctrl-callback-result', { message_type: type, request_id: requestId }, opts())
      const b = r.data?.body ?? r.data?.data?.body
      if (typeof b === 'string' && b && b !== '{}') {
        const msg = v1[R].decode(fromB64(b))
        return v1[R].toObject(msg, { longs: String, enums: String, defaults: false, arrays: true })
      }
    }
  } catch (e) {
    if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') throw new DeviceTimeout()
    throw e
  }
  throw new DeviceTimeout()
}
