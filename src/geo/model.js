import { parseRegion, regionInfo } from '@/utils/region'
import { appTypeName } from '@/utils/format'
import { communityName, geoQuery } from './normalize'

// 状态是位掩码：1 已创建 | 2 已交付 | 4 已验收（/v1/project-statuses）
export function statusName(status, delivered) {
  const s = Number(status) || 0
  if (s & 4) return '已验收'
  if (s & 2 || delivered) return '已交付'
  return '已创建'
}

// 把两种接口（/ctrl/projects 与 /project/new-list）的项目统一成页面所需的最小字段。
// 不保留客户姓名、电话、门牌等字段。
export function toProject(raw) {
  const region = parseRegion(raw.customer_region || raw.region)
  const city = regionInfo(region.city)
  const district = regionInfo(region.district)
  const fromAddr = communityName(raw.customer_address)
  const fromName = communityName(raw.name)
  // 以 name 为主（小区名 + 楼/户号），customer_address 作为第二候选
  const communities = [...new Set([fromName, fromAddr].filter(Boolean))]
  const queries = communities.map((c) => geoQuery(city?.name, district?.name, c))
  const created = raw.created_at || raw.create_time || ''
  const rawName = String(raw.name || '').trim()
  return {
    id: raw.id,
    name: rawName, // 小区+户号原文：仅在登录后的小区弹窗里显示，不写入缓存/日志
    state: 'normal', // normal | offline | warning | alarm（见 geo/states.js）
    alarmCount: 0,
    newAlarm: false,
    community: communities[0] || '',
    queries,
    keywords: communities, // 小区名（不带市区前缀），用于 POI 搜索兜底
    province: region.province,
    city: region.city,
    cityName: city?.name || '',
    district: region.district,
    districtName: district?.name || '未填区县',
    type: appTypeName(raw.app_name),
    category: raw.app_category_name || '',
    status: statusName(raw.status, raw.is_delivered),
    area: Number(raw.building_area) || 0,
    rooms: Number(raw.brief_stat?.room_count ?? raw.room_count) || 0,
    devices: Number(raw.brief_stat?.device_count ?? raw.device_count) || 0,
    created,
    month: created.slice(0, 7),
    enabled: raw.enabled !== false,
    geoCity: region.district || region.city, // 高德 Geocoder city 参数直接用区县 adcode，限定在该区内匹配
    year: created.slice(0, 4),
    distributorId: raw.distributor_id || '',
    distributorName: raw.distributor_name || '',
  }
}
