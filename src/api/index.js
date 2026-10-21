// 只使用平台的只读接口（登录 / 续期 / 查询）。不调用任何新增、修改、删除接口。
// 数据范围由后端按当前 token 的账号权限过滤——前端不硬编码任何经销商/区域条件。
import http from './http'

export const login = (mobile, password) =>
  http.post('/auth/login', { mobile, password }, { skipAuth: true }).then((r) => r.data)

export const me = () => http.get('/me').then((r) => r.data)

export const getDistributor = (id) =>
  http.get(`/distributor/${id}`).then((r) => r.data?.distributor_entity || null)

// 分页项目查询。平台有两个同构接口：/projects 与 /ctrl/projects，
// 按 /me 返回的 permission_paths 选择当前账号有权限的那个。
const PROJECT_ENDPOINTS = ['/projects', '/ctrl/projects']

export function pickProjectEndpoint(permissionPaths = []) {
  const set = new Set(permissionPaths)
  return PROJECT_ENDPOINTS.find((p) => set.has(`/v1${p}`)) || null
}

export function projectPage(endpoint, { page, limit, region }) {
  return http
    .post(endpoint, {
      customer_region: region || '',
      device_model_id: '',
      page_options: { page, limit },
      project_ids: [],
      special_fields: [],
      tags: [],
    })
    .then((r) => ({
      list: r.data?.project_entities || r.data?.entities || [],
      total: parseInt(r.data?.total, 10) || 0, // total 为字符串（如 "702"）
    }))
}

// 翻页取完当前账号可见的全部项目（region 为空 = 全部；也可传 "省/市" 代码前缀）
// onPage(list, total)：每取到一页立即回调，页面可渐进显示
export async function listAllProjects(endpoint, { region = '', limit = 200, concurrency = 3, onProgress, onPage, isStale } = {}) {
  const first = await projectPage(endpoint, { page: 1, limit, region })
  onPage && onPage(first.list, first.total)
  // 页数由 total 计算，不写死；翻页期间 total 变大则追加页，某页为空则提前结束
  let pages = Math.ceil(first.total / limit)
  const out = [first.list]
  let loaded = first.list.length
  onProgress && onProgress(loaded, first.total)
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
  const results = {}
  async function worker() {
    while (rest.length) {
      if (isStale && isStale()) return
      const page = rest.shift()
      const r = await projectPage(endpoint, { page, limit, region })
      if (isStale && isStale()) return
      results[page] = r.list
      if (!r.list.length) {
        rest.length = 0 // 空页：后面不会再有数据
        continue
      }
      const newPages = Math.ceil(r.total / limit)
      if (newPages > pages) {
        for (let p = pages + 1; p <= newPages; p++) rest.push(p)
        pages = newPages
      }
      onPage && onPage(r.list, r.total)
      loaded += r.list.length
      onProgress && onProgress(loaded, first.total)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  for (let p = 2; p <= pages; p++) out.push(results[p] || [])
  // 按 id 去重（翻页期间若有新项目写入，可能出现重复）
  const seen = new Set()
  return out.flat().filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}

// 兜底：账号没有分页接口权限时，用大屏原有的 new-list（一次返回全部，无分页）
export const listProjectsLegacy = ({ region = '' } = {}) =>
  http
    .post('/project/new-list', { region, start_time: 1643644800000, end_time: Date.now() })
    .then((r) => r.data?.data || [])

// 设备告警（只读）：POST /device-alarms { page_options, level: "1", start_time, end_time }（level 为字符串，时间为毫秒）。
// 字段：timestamp = 最近一次发生时间（created_at 为 UTC 字符串、是该记录首次创建时间，会被复用）；
// status 1 = 未处理、3 = 已处理（updated_at = 处理时间）；end_timestamp = 故障恢复时间（有值表示已恢复）。
const toAlarm = (a) => ({
  id: a.id,
  projectId: a.project_id,
  ts: Number(a.timestamp) || 0,
  end: Number(a.end_timestamp) || 0,
  status: Number(a.status) || 0,
  level: Number(a.level) || 9,
  device: a.device_info || '',
  content: a.content || '',
  type: a.equipment_type_name || '',
})
export async function listAlarms({ level = '1', days = 10, limit = 100, concurrency = 3 } = {}) {
  const end = Date.now()
  const body = (page) => ({ page_options: { page, limit }, level: String(level), start_time: end - days * 86400000, end_time: end })
  const get = (page) =>
    http.post('/device-alarms', body(page)).then((r) => ({
      list: r.data?.device_alarm_entities || [],
      total: parseInt(r.data?.total, 10) || 0,
    }))
  const first = await get(1)
  const pages = Math.min(50, Math.ceil(first.total / limit))
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
  const out = [...first.list]
  async function worker() {
    while (rest.length) {
      const r = await get(rest.shift())
      if (!r.list.length) {
        rest.length = 0
        break
      }
      out.push(...r.list)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const seen = new Set()
  return out.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).map(toAlarm)
}
