// 设备透传查询（参照 niuniu）：POST /ctrl-message/pass 发查询 → 轮询 /ctrl-callback-result（3 秒 × 5 次）→ protobuf 解码。
// 只用于查询类消息（Worker 也只放行 41/40/44/43/30/15）。只在用户打开项目详情页时调用。
import http from './http'

let pbP = null
const pb = () => (pbP ||= import('@/vendor/ctrlcb_pb.js').then((m) => m.ctrlcb.v1))

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
}

export async function ctrlQuery(type, { projectId, userId, query = {}, tries = 5, interval = 3000, signal } = {}) {
  const [Q, R] = TYPES[type] || []
  if (!R) throw new Error(`unsupported message_type ${type}`)
  const v1 = await pb()
  const body = Q ? toB64(v1[Q].encode(v1[Q].fromObject(query)).finish()) : '{}'
  const sent = await http.post('/ctrl-message/pass', { project_id: projectId, message_type: type, body, ...(userId ? { user_id: userId } : {}), ...(type === 30 ? { shadow_body: '' } : {}) })
  const requestId = sent.data?.request_id || sent.data?.data?.request_id
  if (!requestId) throw new DeviceTimeout()
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, interval))
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const r = await http.post('/ctrl-callback-result', { message_type: type, request_id: requestId })
    const b = r.data?.body ?? r.data?.data?.body
    if (typeof b === 'string' && b && b !== '{}') {
      const msg = v1[R].decode(fromB64(b))
      return v1[R].toObject(msg, { longs: String, enums: String, defaults: false, arrays: true })
    }
  }
  throw new DeviceTimeout()
}
